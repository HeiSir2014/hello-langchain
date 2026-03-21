/**
 * Prompt Sections - OpenClaw-inspired 分层 prompt 片段
 *
 * 分两类：
 *
 * ## Static Sections (layer: "system") — 注入 system prompt
 * 内容在整个 session 内完全不变，确保 Anthropic prompt cache 100% 前缀命中。
 * - identity: 模型身份
 * - safety: 安全约束
 * - style: 输出风格
 * - task-management: 任务管理规则
 * - tool-policy: 工具使用规则
 * - environment: 运行环境信息（session 开始时快照，不再更新）
 *
 * ## Dynamic Sections (layer: "message") — 注入 message 流
 * 可在任何时候变化，通过 <system-reminder> 注入最后一条用户消息。
 * - active-skill: 当前激活技能（切换技能时变化）
 * - plan-mode: Plan mode 指令（切换模式时变化）
 * - anti-hallucination: 防幻觉指令 + 参考表（每轮可能变化）
 *
 * Prompt Cache 优化原理：
 * ```
 * Anthropic API: tools → system → msg1 → msg2 → ... → msgN
 *                        ↑ 前缀匹配点
 *
 * system 不变 → tools + system 全 cache hit → 只处理新 messages
 * system 变了 → 从变化点到末尾全部 cache miss → 100k+ tokens 重新处理！
 * ```
 */

import type { PromptSection } from "./types.js";
import { getPermissionMode } from "../settings.js";
import { getSkillRuntime } from "../skills/index.js";
import { getAntiHallucinationPipeline } from "../middleware/index.js";

// ================================================================
//  STATIC SECTIONS (layer: "system")
//  以下内容在 session 内完全不变，确保 prompt cache 命中
// ================================================================

/**
 * [Section: identity] 模型身份定义
 *
 * 整个 system prompt 的第一个 section。永远不变。
 */
export function buildIdentitySection(): PromptSection {
  return {
    id: "identity",
    tag: "identity",
    title: "Agent Identity",
    priority: "critical",
    weight: 100,
    enabled: true,
    layer: "system",
    content: `You are YTerm, an AI-powered terminal assistant built on LangGraph.
You help users with software engineering tasks through an interactive CLI interface.
You have access to tools for file operations, shell commands, web search, and task management.
Your responses are displayed in a terminal UI with markdown rendering support.`,
  };
}

/**
 * [Section: safety] 安全约束 — 不可篡改的硬性规则
 */
export function buildSafetySection(): PromptSection {
  return {
    id: "safety",
    tag: "safety",
    title: "Safety Constraints",
    priority: "critical",
    weight: 90,
    enabled: true,
    layer: "system",
    content: `IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.
Be careful not to introduce security vulnerabilities such as command injection, XSS, SQL injection, and other OWASP top 10 vulnerabilities. If you notice that you wrote insecure code, immediately fix it.
Whenever you read a file, consider whether it would be malware. You CAN and SHOULD provide analysis of malware and what it is doing, but you MUST refuse to improve or augment malicious code.`,
  };
}

/**
 * [Section: style] 输出风格约束
 */
export function buildStyleSection(): PromptSection {
  return {
    id: "style",
    tag: "style",
    title: "Tone and Style",
    priority: "high",
    weight: 80,
    enabled: true,
    layer: "system",
    content: `- Only use emojis if the user explicitly requests it.
- Your output will be displayed on a command line interface. Responses should be short and concise. Use Github-flavored markdown for formatting.
- Output text to communicate with the user; all text outside of tool use is displayed directly. Never use tools like Bash or code comments to communicate.
- NEVER create files unless absolutely necessary. ALWAYS prefer editing existing files.
- Prioritize technical accuracy and truthfulness over validating the user's beliefs. Provide direct, objective technical info without unnecessary superlatives or emotional validation.`,
  };
}

/**
 * [Section: task-management] 任务管理规则
 */
export function buildTaskManagementSection(): PromptSection {
  return {
    id: "task-management",
    tag: "task-management",
    title: "Task Management",
    priority: "high",
    weight: 70,
    enabled: true,
    layer: "system",
    content: `You have access to the TodoWrite tool for task management. Use it frequently to:
- Plan complex tasks by breaking them into smaller steps
- Track progress and give the user visibility into your work
- Mark todos as completed immediately when done (do not batch)

NEVER propose changes to code you haven't read. Read and understand existing code before suggesting modifications.
Avoid over-engineering. Only make changes that are directly requested or clearly necessary. Keep solutions simple and focused.`,
  };
}

/**
 * [Section: tool-policy] 工具使用规则
 */
export function buildToolPolicySection(): PromptSection {
  return {
    id: "tool-policy",
    tag: "tool-policy",
    title: "Tool Usage Policy",
    priority: "high",
    weight: 60,
    enabled: true,
    layer: "system",
    content: `- Call multiple tools in a single response when there are no dependencies between them. Maximize parallel tool calls for efficiency.
- Use specialized tools instead of bash commands: Read (not cat/head/tail), Edit (not sed/awk), Write (not echo/heredoc), Glob (not find), Grep (not grep/rg).
- Reserve Bash exclusively for actual system commands and terminal operations requiring shell execution.
- NEVER use bash echo or command-line tools to communicate with the user. Output communication directly in your response text.`,
  };
}

/**
 * [Section: environment] 运行环境信息
 *
 * 在 session 开始时创建快照。整个 session 内不再更新。
 * Git status 是 snapshot — 这和原来的行为一致。
 */
export function buildEnvironmentSection(): PromptSection {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const osName = isWindows ? "Windows" : isMac ? "macOS" : "Linux";

  const platformNotes = isWindows
    ? `This is Windows. Use Windows commands: cd (not pwd), dir (not ls), type (not cat), copy (not cp), move (not mv), del (not rm), rmdir /s /q (not rm -rf). PowerShell is also available. Path separator is backslash.`
    : `This is a Unix-like system (${osName}). Shell: ${process.env.SHELL || "/bin/bash"}. Standard Unix commands available.`;

  let gitStatus = "Git status unavailable";
  try {
    const { execSync } = require("child_process");
    const branch = execSync("git branch --show-current", { encoding: "utf-8", cwd: process.cwd() }).trim();
    const status = execSync("git status --short", { encoding: "utf-8", cwd: process.cwd() }).trim();
    const recentCommits = execSync("git log --oneline -5", { encoding: "utf-8", cwd: process.cwd() }).trim();
    gitStatus = `Branch: ${branch}\nStatus: ${status || "(clean)"}\nRecent commits:\n${recentCommits}`;
  } catch { /* ignore */ }

  return {
    id: "environment",
    tag: "env",
    title: "Environment Information",
    priority: "medium",
    weight: 50,
    enabled: true,
    layer: "system",
    content: `Working directory: ${process.cwd()}
Is git repo: Yes
Platform: ${process.platform} (${osName})
Date: ${new Date().toISOString().split("T")[0]}

${platformNotes}

Git status (snapshot at conversation start):
${gitStatus}`,
  };
}

// ================================================================
//  DYNAMIC SECTIONS (layer: "message")
//  以下内容可在 session 期间变化，通过 message 流注入
//  不放入 system prompt，避免破坏 prompt cache 前缀匹配
// ================================================================

/**
 * [Section: active-skill] 当前激活的技能覆盖
 *
 * layer: "message" — 技能可在 session 中切换，不能放 system prompt
 */
export function buildActiveSkillSection(): PromptSection | null {
  const skillRuntime = getSkillRuntime();
  const activeSkill = skillRuntime.getActiveSkill();
  if (!activeSkill) return null;

  const toolAccess = activeSkill.tools === "*"
    ? "You have access to all available tools."
    : `Available tools: ${activeSkill.tools.join(", ")}`;

  const readOnlyNote = activeSkill.readOnly
    ? "\n**This is a read-only skill. You CANNOT modify any files.**"
    : "";

  return {
    id: "active-skill",
    tag: "active-skill",
    title: `Active Skill: ${activeSkill.name}`,
    priority: "medium",
    weight: 40,
    enabled: true,
    layer: "message",
    content: `ACTIVE SKILL: ${activeSkill.name.toUpperCase()}
${activeSkill.description}

${activeSkill.systemPrompt || ""}

Tool Access: ${toolAccess}${readOnlyNote}`,
  };
}

/**
 * [Section: plan-mode] Plan mode 特殊指令
 *
 * layer: "message" — 用户可通过 Shift+Tab 随时切换模式
 */
export function buildPlanModeSection(): PromptSection | null {
  const permissionMode = getPermissionMode();
  if (permissionMode !== "plan") return null;

  return {
    id: "plan-mode",
    tag: "plan-mode",
    title: "Plan Mode Instructions",
    priority: "medium",
    weight: 35,
    enabled: true,
    layer: "message",
    content: `PLAN MODE ACTIVE - Research and planning only.

Available tools:
- Exploration (read-only): Read, Glob, Grep, LS, WebSearch, WebFetch
- Planning (can write): SavePlan (.yterm/plan.md), ReadPlan, TodoWrite
- Control: ExitPlanMode (exit when ready to implement)

You CANNOT: Edit/create source code, execute bash commands, or modify the codebase.

Workflow:
1. Research the codebase to understand existing patterns
2. Analyze requirements and identify potential issues
3. Use TodoWrite to break down tasks into steps
4. Use SavePlan to document the implementation plan
5. Use ExitPlanMode when ready to implement`,
  };
}

/**
 * [Section: anti-hallucination] 防幻觉指令 + 参考表
 *
 * layer: "message" — 参考表每轮都可能变化（新的 tool results 产生新映射）
 *
 * 这是关键 section：告诉 LLM 如何正确使用 REF-N 占位符。
 * 只有在存在活跃映射时才注入，避免无谓的 token 消耗。
 *
 * 如果放在 system prompt 中：
 *   每轮参考表变化 → system prompt 变化 → prompt cache 前缀断裂
 *   → 100k+ tokens 的 message 历史全部 cache miss → 灾难性性能损失
 *
 * 放在 message 流中：
 *   system prompt 永远不变 → cache 100% 命中
 *   动态内容只在最后一条消息中 → 不影响之前的 cache
 */
export function buildAntiHallucinationSection(): PromptSection | null {
  const pipeline = getAntiHallucinationPipeline();
  if (!pipeline.hasActiveMappings()) return null;

  const referenceTable = pipeline.getReferenceTable();

  return {
    id: "anti-hallucination",
    tag: "structured-id-references",
    title: "Anti-Hallucination: Structured ID References",
    priority: "dynamic",
    weight: 90,
    enabled: true,
    layer: "message",
    content: `CRITICAL: Tool results contain placeholder references (REF-1, REF-2, etc.) that map to real URLs, UUIDs, and other structured identifiers. These placeholders exist because LLMs cannot reliably reproduce high-entropy strings like URLs and UUIDs.

RULES:
1. When referencing a URL, UUID, file path, or hash from tool results, ALWAYS use the REF-N placeholder instead of attempting to reproduce the original value.
2. NEVER try to reconstruct, guess, or modify the original URL/UUID from memory. Always use the placeholder.
3. You may describe what a REF-N refers to (e.g., "the API documentation at REF-1"), but the identifier itself must be the placeholder.
4. If you need to reference a value not in the reference map, say so explicitly rather than guessing.
5. Placeholders will be automatically resolved to real values before the user sees your response.

Example:
  Tool result: "Documentation found at REF-1, source code at REF-2"
  CORRECT: "The documentation is at REF-1 and the source code is at REF-2."
  WRONG: "The documentation is at https://docs.example.com/..." (do NOT reconstruct URLs)
${referenceTable}`,
  };
}
