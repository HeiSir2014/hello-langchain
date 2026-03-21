/**
 * Prompt Section Types
 *
 * OpenClaw-inspired 分层 prompt 架构的类型定义。
 *
 * 设计原则：
 * - 每个 section 是独立的、可组合的 prompt 片段
 * - 严格的优先级排序确保 prompt cache 命中率最大化
 * - XML 标签包裹每个 section，便于模型理解结构边界
 * - 不变内容（identity, policy）置于最前，高变内容（dynamic state）置于最后
 */

/** Prompt section 优先级层级 */
export type SectionPriority =
  | "critical"    // 身份、安全约束 — 永远在最前面
  | "high"        // 核心行为规则
  | "medium"      // 环境信息、技能
  | "low"         // 动态状态、提示
  | "dynamic";    // 每轮变化的内容（参考表、todo）

/** 单个 prompt section */
export interface PromptSection {
  /** Section 唯一标识 */
  id: string;
  /** XML 标签名 (e.g. "identity", "tools-policy") */
  tag: string;
  /** Section 标题（注释用，不注入 prompt） */
  title: string;
  /** Section 内容 */
  content: string;
  /** 优先级层级 */
  priority: SectionPriority;
  /** 数值排序权重（同优先级内排序，越大越靠前） */
  weight: number;
  /** 是否启用（可动态关闭） */
  enabled: boolean;
}

/** Prompt builder 配置 */
export interface PromptBuilderConfig {
  /** 是否使用 XML 标签包裹 sections */
  useXmlTags: boolean;
  /** 是否在 section 之间插入分隔符 */
  useSeparators: boolean;
  /** 最大 prompt 长度（字符数，0 表示不限制） */
  maxLength: number;
}

/** Section 工厂函数签名 */
export type SectionFactory = () => PromptSection | null;

/** 优先级排序映射 */
export const PRIORITY_ORDER: Record<SectionPriority, number> = {
  critical: 500,
  high: 400,
  medium: 300,
  low: 200,
  dynamic: 100,
};
