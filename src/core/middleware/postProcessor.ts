/**
 * Post-Processing Layer - 模型输出校正
 *
 * 在 LLM 响应返回给用户之前执行的确定性校正步骤。
 * 作为 ID 重映射的补充层，处理以下场景：
 *
 * 1. 占位符还原（由 idRemapper 处理）
 * 2. 残留高熵字符串检测和校正
 * 3. 输出验证和异常标记
 */

import {
  type RemapSession,
  type RestoreResult,
  type CorrectionEntry,
  restoreFromPlaceholders,
  extractHighEntropyStrings,
} from "./idRemapper.js";
import { log } from "../../logger.js";

// ============ 类型定义 ============

/** 验证结果 */
export interface ValidationResult {
  /** 是否通过验证 */
  valid: boolean;
  /** 警告信息 */
  warnings: ValidationWarning[];
}

/** 验证警告 */
export interface ValidationWarning {
  /** 警告类型 */
  type: "unresolved_placeholder" | "suspicious_url" | "suspicious_uuid" | "unknown_id";
  /** 相关值 */
  value: string;
  /** 在输出中的位置 */
  position?: number;
  /** 建议操作 */
  suggestion?: string;
}

/** 完整的后处理结果 */
export interface PostProcessResult {
  /** 处理后的内容 */
  content: string;
  /** 还原统计 */
  restore: RestoreResult;
  /** 验证结果 */
  validation: ValidationResult;
}

// ============ 占位符模式 ============

const UNRESOLVED_PLACEHOLDER = /\bREF-\d+\b/g;

// ============ 核心实现 ============

/**
 * 执行完整的后处理管道
 *
 * Pipeline: 还原占位符 → 模糊匹配校正 → 验证输出
 */
export function postProcess(output: string, session: RemapSession): PostProcessResult {
  // 1. 还原占位符 + 模糊匹配校正
  const restoreResult = restoreFromPlaceholders(output, session);

  // 2. 验证最终输出
  const validation = validateOutput(restoreResult.content, session);

  // 3. 记录校正日志
  if (restoreResult.corrections.length > 0) {
    log.info("ID remapper corrections applied", {
      count: restoreResult.corrections.length,
      corrections: restoreResult.corrections.map(c => ({
        type: c.type,
        confidence: c.confidence.toFixed(2),
      })),
    });
  }

  if (validation.warnings.length > 0) {
    log.warn("Post-processing validation warnings", {
      count: validation.warnings.length,
      types: validation.warnings.map(w => w.type),
    });
  }

  return {
    content: restoreResult.content,
    restore: restoreResult,
    validation,
  };
}

/**
 * 验证后处理输出
 *
 * 检查：
 * 1. 是否有未解析的占位符残留
 * 2. 是否有可疑的 URL/UUID（可能是模型幻觉）
 */
export function validateOutput(content: string, session: RemapSession): ValidationResult {
  const warnings: ValidationWarning[] = [];

  // 1. 检查未解析的占位符
  const unresolvedMatches = content.match(UNRESOLVED_PLACEHOLDER);
  if (unresolvedMatches) {
    for (const match of unresolvedMatches) {
      warnings.push({
        type: "unresolved_placeholder",
        value: match,
        suggestion: "This placeholder was not found in the reference map",
      });
    }
  }

  // 2. 如果会话有映射，检查输出中是否有不在映射中的高熵字符串
  if (session.entries.length > 0) {
    const outputHighEntropy = extractHighEntropyStrings(content);
    for (const { value, type } of outputHighEntropy) {
      // 跳过已知的原始值
      if (session.originalToPlaceholder.has(value)) continue;

      // 这个值不在我们的映射中 - 可能是模型幻觉
      const warningType = type === "url" ? "suspicious_url"
        : type === "uuid" ? "suspicious_uuid"
        : "unknown_id";

      warnings.push({
        type: warningType,
        value,
        suggestion: `This ${type} was not in the tool results and may be hallucinated`,
      });
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

/**
 * 从 tool_result 内容中提取已知的合法 URL 集合
 * 用于后续输出验证时区分"合法引用"和"潜在幻觉"
 */
export function buildKnownValueSet(session: RemapSession): Set<string> {
  const known = new Set<string>();
  for (const entry of session.entries) {
    known.add(entry.original);
  }
  return known;
}
