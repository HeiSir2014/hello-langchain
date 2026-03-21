/**
 * Middleware Pipeline - 防幻觉消息管道编排器
 *
 * 架构：五层防护 + 消息流转管道
 *
 * ```
 * [Tool Result] → preProcess() → [替换高熵ID为占位符] → [发送给LLM]
 *                                                           ↓
 * [用户渲染] ← postProcess() ← [还原占位符] ← [LLM 响应]
 * ```
 *
 * 每轮 agent 交互维护独立的 RemapSession，
 * 确保占位符编号在轮次内连续、轮次间独立。
 */

import {
  type RemapSession,
  type RemapEntry,
  createRemapSession,
  remapToolResult,
  generateReferenceTable,
} from "./idRemapper.js";
import {
  type PostProcessResult,
  postProcess,
} from "./postProcessor.js";
import { log } from "../../logger.js";

// ============ 类型定义 ============

/** Pipeline 配置 */
export interface PipelineConfig {
  /** 是否启用 ID 重映射 (默认: true) */
  enableIdRemapping: boolean;
  /** 是否启用模糊匹配后处理 (默认: true) */
  enableFuzzyCorrection: boolean;
  /** 是否在系统提示中注入参考表 (默认: true) */
  enableReferenceTable: boolean;
  /** 需要跳过重映射的工具列表 */
  skipTools: string[];
}

/** Pipeline 统计信息 */
export interface PipelineStats {
  /** 本轮重映射的条目数 */
  remappedCount: number;
  /** 还原的占位符数 */
  restoredCount: number;
  /** 模糊匹配校正数 */
  correctionCount: number;
  /** 验证警告数 */
  warningCount: number;
}

// ============ 默认配置 ============

const DEFAULT_CONFIG: PipelineConfig = {
  enableIdRemapping: true,
  enableFuzzyCorrection: true,
  enableReferenceTable: true,
  skipTools: [
    // 这些工具的输出不太可能包含需要保护的高熵ID
    "TodoWrite",
    "ExitPlanMode",
    "KillShell",
  ],
};

// ============ Pipeline 类 ============

/**
 * AntiHallucinationPipeline - 防幻觉消息管道
 *
 * 使用方式：
 * 1. 每轮 agent 交互创建新实例或调用 reset()
 * 2. 工具执行后调用 processToolResult() 预处理结果
 * 3. LLM 响应后调用 processModelOutput() 后处理输出
 * 4. 获取 getReferenceTable() 注入系统提示
 */
export class AntiHallucinationPipeline {
  private session: RemapSession;
  private config: PipelineConfig;
  private stats: PipelineStats;

  constructor(config?: Partial<PipelineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.session = createRemapSession();
    this.stats = { remappedCount: 0, restoredCount: 0, correctionCount: 0, warningCount: 0 };
  }

  /**
   * Pre-processing: 处理 tool_result 内容
   *
   * 将高熵标识符替换为占位符，返回安全内容发送给 LLM
   */
  processToolResult(content: string, toolName: string): string {
    if (!this.config.enableIdRemapping) return content;
    if (this.config.skipTools.includes(toolName)) return content;

    const beforeCount = this.session.entries.length;
    const processed = remapToolResult(content, this.session, toolName);
    const newEntries = this.session.entries.length - beforeCount;

    if (newEntries > 0) {
      this.stats.remappedCount += newEntries;
      log.debug("Pipeline: tool result processed", {
        tool: toolName,
        newMappings: newEntries,
        totalMappings: this.session.entries.length,
      });
    }

    return processed;
  }

  /**
   * Post-processing: 处理 LLM 输出
   *
   * 还原占位符、执行模糊匹配校正、验证输出
   */
  processModelOutput(output: string): PostProcessResult {
    if (!this.config.enableIdRemapping || this.session.entries.length === 0) {
      return {
        content: output,
        restore: { content: output, restoredCount: 0, corrections: [] },
        validation: { valid: true, warnings: [] },
      };
    }

    const result = postProcess(output, this.session);

    // 更新统计
    this.stats.restoredCount += result.restore.restoredCount;
    this.stats.correctionCount += result.restore.corrections.length;
    this.stats.warningCount += result.validation.warnings.length;

    if (result.restore.restoredCount > 0 || result.restore.corrections.length > 0) {
      log.info("Pipeline: model output processed", {
        restored: result.restore.restoredCount,
        corrections: result.restore.corrections.length,
        warnings: result.validation.warnings.length,
      });
    }

    return result;
  }

  /**
   * 获取参考表（用于注入系统提示）
   */
  getReferenceTable(): string {
    if (!this.config.enableReferenceTable) return "";
    return generateReferenceTable(this.session);
  }

  /**
   * 获取当前会话信息
   */
  getSession(): Readonly<RemapSession> {
    return this.session;
  }

  /**
   * 获取统计信息
   */
  getStats(): Readonly<PipelineStats> {
    return { ...this.stats };
  }

  /**
   * 检查是否有活跃的映射
   */
  hasActiveMappings(): boolean {
    return this.session.entries.length > 0;
  }

  /**
   * 重置管道状态（新一轮交互）
   */
  reset(): void {
    this.session = createRemapSession();
    this.stats = { remappedCount: 0, restoredCount: 0, correctionCount: 0, warningCount: 0 };
  }
}

// ============ 全局单例 ============

/** 全局管道实例 */
let globalPipeline: AntiHallucinationPipeline | null = null;

/**
 * 获取全局管道实例（惰性初始化）
 */
export function getAntiHallucinationPipeline(): AntiHallucinationPipeline {
  if (!globalPipeline) {
    globalPipeline = new AntiHallucinationPipeline();
  }
  return globalPipeline;
}

/**
 * 重置全局管道（新一轮 agent 交互时调用）
 */
export function resetPipeline(): void {
  if (globalPipeline) {
    const stats = globalPipeline.getStats();
    if (stats.remappedCount > 0) {
      log.info("Pipeline reset", {
        previousStats: stats,
      });
    }
    globalPipeline.reset();
  }
}
