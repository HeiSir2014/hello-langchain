/**
 * Prompt Module - OpenClaw-inspired 分层 system prompt 架构
 *
 * 两层架构（为 Anthropic prompt cache 优化）：
 *
 * 1. System Prompt (100% STATIC):
 *    buildSystemPrompt() → identity, safety, style, task, tools, env
 *    整个 session 内完全不变 → cache 前缀 100% 命中
 *
 * 2. Message Injection (DYNAMIC):
 *    buildDynamicInjection() → active-skill, plan-mode, anti-hallucination
 *    通过 <system-reminder> 注入最后一条用户消息 → 不破坏 cache
 *
 * 模块组织：
 * - types.ts:    Section 类型定义、layer/priority 层级
 * - sections.ts: 各 section factory（static 6个 + dynamic 3个）
 * - builder.ts:  PromptBuilder 组装器（分层构建、排序、XML 包裹）
 */

export {
  PromptBuilder,
  getPromptBuilder,
  buildSystemPrompt,
  buildDynamicInjection,
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
  type SectionLayer,
  PRIORITY_ORDER,
} from "./types.js";
