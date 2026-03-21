/**
 * Prompt Builder - OpenClaw-inspired 分层 prompt 组装器
 *
 * 核心设计：严格区分 static / dynamic 两层
 *
 * ```
 * Anthropic Cache 前缀匹配：
 *   tools → system prompt → msg1 → msg2 → ... → msgN
 *           ↑ 如果这里变了，后面全部 cache miss
 *
 * 正确架构：
 *   System Prompt (100% STATIC — 整个 session 不变):
 *     [identity] [safety] [style] [task] [tool-policy] [environment]
 *     → prompt cache 前缀完全命中 → 只需处理新 messages
 *
 *   Message Injection (DYNAMIC — 每轮可变):
 *     [active-skill] [plan-mode] [anti-hallucination]
 *     → 通过 <system-reminder> 注入最后一条用户消息
 *     → 不影响 system prompt 的 cache 前缀
 * ```
 *
 * 长上下文场景 (100k+ tokens) 的影响：
 * - system prompt 不变: 每轮只处理新增的 ~2k tokens → 快速、低成本
 * - system prompt 变了: 每轮重新处理 100k+ tokens → 慢、高成本
 */

import {
  type PromptSection,
  type PromptBuilderConfig,
  type SectionFactory,
  PRIORITY_ORDER,
} from "./types.js";
import {
  buildIdentitySection,
  buildSafetySection,
  buildStyleSection,
  buildTaskManagementSection,
  buildToolPolicySection,
  buildEnvironmentSection,
  buildActiveSkillSection,
  buildPlanModeSection,
  buildAntiHallucinationSection,
} from "./sections.js";
import { log } from "../../logger.js";

// ============ 默认配置 ============

const DEFAULT_CONFIG: PromptBuilderConfig = {
  useXmlTags: true,
  useSeparators: false,
  maxLength: 0,
};

// ============ PromptBuilder ============

export class PromptBuilder {
  private config: PromptBuilderConfig;
  /** 注册的 section factories（按注册顺序） */
  private factories: Map<string, SectionFactory> = new Map();
  /** Section 覆盖/禁用 */
  private overrides: Map<string, Partial<PromptSection>> = new Map();

  constructor(config?: Partial<PromptBuilderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerDefaultSections();
  }

  /**
   * 注册默认的 section factories
   *
   * Static (system prompt): identity → safety → style → task → tools → env
   * Dynamic (message injection): active-skill → plan-mode → anti-hallucination
   */
  private registerDefaultSections(): void {
    // Static: 注入 system prompt（永不变）
    this.register("identity", buildIdentitySection);
    this.register("safety", buildSafetySection);
    this.register("style", buildStyleSection);
    this.register("task-management", buildTaskManagementSection);
    this.register("tool-policy", buildToolPolicySection);
    this.register("environment", buildEnvironmentSection);

    // Dynamic: 注入 message 流（可变）
    this.register("active-skill", buildActiveSkillSection);
    this.register("plan-mode", buildPlanModeSection);
    this.register("anti-hallucination", buildAntiHallucinationSection);
  }

  /**
   * 注册一个 section factory
   */
  register(id: string, factory: SectionFactory): void {
    this.factories.set(id, factory);
  }

  /**
   * 移除一个已注册的 section
   */
  unregister(id: string): void {
    this.factories.delete(id);
  }

  /**
   * 覆盖某个 section 的部分属性
   */
  override(id: string, overrides: Partial<PromptSection>): void {
    this.overrides.set(id, overrides);
  }

  /**
   * 禁用某个 section
   */
  disable(id: string): void {
    this.overrides.set(id, { enabled: false });
  }

  /**
   * 启用某个 section
   */
  enable(id: string): void {
    const existing = this.overrides.get(id);
    if (existing) {
      delete existing.enabled;
      if (Object.keys(existing).length === 0) {
        this.overrides.delete(id);
      }
    }
  }

  /**
   * 构建 system prompt（仅 layer: "system" 的静态 sections）
   *
   * 输出在整个 session 内保持不变，确保 prompt cache 前缀命中。
   * 不包含任何可能变化的内容。
   */
  build(): string {
    return this.buildByLayer("system");
  }

  /**
   * 构建 message-level 动态注入内容（仅 layer: "message" 的 sections）
   *
   * 输出通过 <system-reminder> 注入最后一条用户消息。
   * 包含技能覆盖、模式切换、防幻觉参考表等动态内容。
   *
   * @returns 动态注入内容，如果没有动态 section 则返回空字符串
   */
  buildDynamicInjection(): string {
    return this.buildByLayer("message");
  }

  /**
   * 按 layer 过滤并构建 sections
   */
  private buildByLayer(layer: "system" | "message"): string {
    const sections = this.collectSections(layer);

    // 组装
    const parts = sections.map(section => this.formatSection(section));
    let result = parts.join("\n\n");

    // 长度限制（仅对 system prompt 生效）
    if (layer === "system" && this.config.maxLength > 0 && result.length > this.config.maxLength) {
      log.warn("System prompt exceeds max length, truncating", {
        length: result.length,
        maxLength: this.config.maxLength,
      });
      while (result.length > this.config.maxLength && sections.length > 0) {
        const removed = sections.pop()!;
        log.debug(`Truncating section: ${removed.id}`);
        const newParts = sections.map(s => this.formatSection(s));
        result = newParts.join("\n\n");
      }
    }

    log.debug(`Prompt ${layer} layer built`, {
      sectionCount: sections.length,
      sectionIds: sections.map(s => s.id),
      totalLength: result.length,
    });

    return result;
  }

  /**
   * 收集、过滤、排序指定 layer 的 sections
   */
  private collectSections(layer?: "system" | "message"): PromptSection[] {
    const sections: PromptSection[] = [];

    for (const [id, factory] of this.factories) {
      try {
        const section = factory();
        if (!section) continue;

        // 应用 overrides
        const override = this.overrides.get(id);
        if (override) {
          Object.assign(section, override);
        }

        if (!section.enabled) continue;
        if (layer && section.layer !== layer) continue;

        sections.push(section);
      } catch (error: any) {
        log.warn(`Prompt section "${id}" build failed`, { error: error.message });
      }
    }

    // 排序：先按优先级层级，再按权重
    sections.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.weight - a.weight;
    });

    return sections;
  }

  /**
   * 格式化单个 section
   */
  private formatSection(section: PromptSection): string {
    if (this.config.useXmlTags) {
      return `<${section.tag}>\n${section.content}\n</${section.tag}>`;
    }
    return section.content;
  }

  /**
   * 获取当前注册的所有 section IDs
   */
  getRegisteredSections(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * 获取 build 后的 section 列表（用于调试）
   */
  buildSections(layer?: "system" | "message"): PromptSection[] {
    return this.collectSections(layer);
  }
}

// ============ 全局实例 ============

let globalBuilder: PromptBuilder | null = null;

/**
 * 获取全局 PromptBuilder 实例
 */
export function getPromptBuilder(): PromptBuilder {
  if (!globalBuilder) {
    globalBuilder = new PromptBuilder();
  }
  return globalBuilder;
}

/**
 * 构建系统提示（便捷函数）— 仅静态内容
 *
 * 等价于 getPromptBuilder().build()
 */
export function buildSystemPrompt(): string {
  return getPromptBuilder().build();
}

/**
 * 构建动态注入内容（便捷函数）— 技能/模式/防幻觉
 *
 * 等价于 getPromptBuilder().buildDynamicInjection()
 */
export function buildDynamicInjection(): string {
  return getPromptBuilder().buildDynamicInjection();
}

/**
 * 重置全局 PromptBuilder（测试用）
 */
export function resetPromptBuilder(): void {
  globalBuilder = null;
}
