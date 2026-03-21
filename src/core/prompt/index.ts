/**
 * Prompt Module - OpenClaw-inspired 分层 system prompt 架构
 *
 * 模块组织：
 * - types.ts:    Section 类型定义、优先级层级
 * - sections.ts: 各 section factory（identity, safety, style, tools, env, skill, mode, anti-hallucination）
 * - builder.ts:  PromptBuilder 组装器（排序、XML 包裹、长度控制）
 */

export {
  PromptBuilder,
  getPromptBuilder,
  buildSystemPrompt,
  resetPromptBuilder,
} from "./builder.js";

export {
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

export {
  type PromptSection,
  type PromptBuilderConfig,
  type SectionFactory,
  type SectionPriority,
  PRIORITY_ORDER,
} from "./types.js";
