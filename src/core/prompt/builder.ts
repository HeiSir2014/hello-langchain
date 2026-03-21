/**
 * Prompt Builder - OpenClaw-inspired 分层 prompt 组装器
 *
 * 设计理念（参考 OpenClaw system prompt 架构）：
 *
 * 1. **分层**: 每个 section 是独立的、可测试的单元
 * 2. **优先级排序**: critical → high → medium → low → dynamic
 *    不变内容在前确保 prompt cache 命中，动态内容在后
 * 3. **XML 标签**: 每个 section 用 XML 标签包裹，帮助模型理解结构边界
 * 4. **可组合**: section 可动态启用/禁用，技能覆盖只添加额外 section
 * 5. **Cache-friendly**: 排序稳定，section ID 唯一，相同配置产生相同输出
 *
 * Prompt Cache 优化（对应 Anthropic 的前缀匹配机制）：
 * ```
 * [identity] [safety] [style] [task] [tool-policy]  ← 几乎不变，cache hit
 * [environment]                                       ← 每 session 不变
 * [active-skill] [plan-mode]                          ← 模式切换时变化
 * [anti-hallucination]                                ← 每轮可能变化
 * ```
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
  maxLength: 0, // 不限制
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
   * 按 OpenClaw 的分层顺序：
   * identity → safety → style → task → tools → env → skill → mode → dynamic
   */
  private registerDefaultSections(): void {
    // Critical: 身份 + 安全（几乎永远不变）
    this.register("identity", buildIdentitySection);
    this.register("safety", buildSafetySection);

    // High: 行为规则（很少变化）
    this.register("style", buildStyleSection);
    this.register("task-management", buildTaskManagementSection);
    this.register("tool-policy", buildToolPolicySection);

    // Medium: 环境 + 技能（每 session 可能不同）
    this.register("environment", buildEnvironmentSection);
    this.register("active-skill", buildActiveSkillSection);
    this.register("plan-mode", buildPlanModeSection);

    // Dynamic: 防幻觉参考表（每轮可能变化）
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
   * 构建最终的 system prompt
   *
   * 流程：
   * 1. 调用所有 factory 生成 sections
   * 2. 应用 overrides
   * 3. 过滤 disabled sections 和 null 结果
   * 4. 按优先级 + 权重排序
   * 5. 用 XML 标签包裹并拼接
   */
  build(): string {
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

        // 过滤禁用的 sections
        if (!section.enabled) continue;

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

    // 组装
    const parts = sections.map(section => this.formatSection(section));
    let result = parts.join("\n\n");

    // 长度限制
    if (this.config.maxLength > 0 && result.length > this.config.maxLength) {
      log.warn("System prompt exceeds max length, truncating dynamic sections", {
        length: result.length,
        maxLength: this.config.maxLength,
      });
      // 从后面（低优先级）开始截断
      while (result.length > this.config.maxLength && sections.length > 0) {
        const removed = sections.pop()!;
        log.debug(`Truncating section: ${removed.id}`);
        const newParts = sections.map(s => this.formatSection(s));
        result = newParts.join("\n\n");
      }
    }

    log.debug("System prompt built", {
      sectionCount: sections.length,
      sectionIds: sections.map(s => s.id),
      totalLength: result.length,
    });

    return result;
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
  buildSections(): PromptSection[] {
    const sections: PromptSection[] = [];

    for (const [id, factory] of this.factories) {
      try {
        const section = factory();
        if (!section) continue;
        const override = this.overrides.get(id);
        if (override) Object.assign(section, override);
        if (!section.enabled) continue;
        sections.push(section);
      } catch { /* skip */ }
    }

    return sections.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.weight - a.weight;
    });
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
 * 构建系统提示（便捷函数）
 *
 * 等价于 getPromptBuilder().build()
 */
export function buildSystemPrompt(): string {
  return getPromptBuilder().build();
}

/**
 * 重置全局 PromptBuilder（测试用）
 */
export function resetPromptBuilder(): void {
  globalBuilder = null;
}
