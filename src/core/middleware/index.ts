/**
 * Middleware Layer - 结构化字段防幻觉工程方案
 *
 * 模块组织：
 * - idRemapper:     ID 重映射核心（占位符替换/还原、模糊匹配）
 * - postProcessor:  后处理校正（验证、异常检测）
 * - pipeline:       管道编排器（全局单例、生命周期管理）
 */

// Pipeline (主入口)
export {
  AntiHallucinationPipeline,
  getAntiHallucinationPipeline,
  resetPipeline,
  type PipelineConfig,
  type PipelineStats,
} from "./pipeline.js";

// ID Remapper
export {
  createRemapSession,
  registerValue,
  remapToolResult,
  restoreFromPlaceholders,
  generateReferenceTable,
  extractHighEntropyStrings,
  classifyHighEntropyString,
  calculateSimilarity,
  type RemapSession,
  type RemapEntry,
  type RestoreResult,
  type CorrectionEntry,
} from "./idRemapper.js";

// Post-Processor
export {
  postProcess,
  validateOutput,
  buildKnownValueSet,
  type PostProcessResult,
  type ValidationResult,
  type ValidationWarning,
} from "./postProcessor.js";
