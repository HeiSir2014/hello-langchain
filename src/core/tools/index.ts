import { Bash, BashOutput, KillShell } from "./bash.js";
import { Read, Write, Glob, Grep, Edit, LS } from "./file.js";
import { TodoWrite, getTodos, setTodos, clearTodos, formatTodosForPrompt } from "./todo.js";
import { WebSearch, WebFetch } from "./web.js";
import { Location, Weather } from "./location.js";
import { MemorySave, MemorySearch } from "./memory.js";
import { ExitPlanMode, SavePlan, ReadPlan, setPreviousModeBeforePlan, getPreviousModeBeforePlan } from "./plan.js";
import {
  TOOL_METADATA,
  SENSITIVE_TOOLS,
  MAX_TOOL_CONCURRENCY,
  getToolMetadata,
  getToolDescriptions,
  isReadOnlyTool,
  isConcurrencySafeTool,
  needsPermission,
  canRunToolsConcurrently,
} from "./types.js";
import { getPermissionMode, PLAN_MODE_TOOLS } from "../settings.js";

// 所有可用工具
export const allTools = [
  Bash, BashOutput, KillShell,
  Read, Write, Glob, Grep, Edit, LS,
  TodoWrite,
  WebSearch, WebFetch,
  Location, Weather,
  MemorySave, MemorySearch,
  ExitPlanMode, SavePlan, ReadPlan,
];

// 根据当前权限模式过滤工具
export function getToolsForCurrentMode() {
  const mode = getPermissionMode();

  if (mode === "plan") {
    // Plan mode: only read-only tools + plan tools
    return allTools.filter((t) => PLAN_MODE_TOOLS.includes(t.name));
  }

  // Other modes: all tools except plan-specific ones
  return allTools.filter((t) => t.name !== "ExitPlanMode");
}

// 根据技能过滤工具
export function getToolsForSkillFilter(allowedTools: string[] | "*") {
  if (allowedTools === "*") {
    return allTools;
  }
  return allTools.filter((t) => allowedTools.includes(t.name));
}

// 获取指定工具名列表对应的工具实例
export function getToolsByNames(toolNames: string[]) {
  const nameSet = new Set(toolNames);
  return allTools.filter((t) => nameSet.has(t.name));
}

// 导出所有工具（向后兼容）
export const tools = allTools.filter((t) => t.name !== "ExitPlanMode" && t.name !== "SavePlan" && t.name !== "ReadPlan");

// 获取只读工具（可并发执行）
export const readOnlyTools = allTools.filter((t) => isReadOnlyTool(t.name));

// 获取需要权限的工具
export const permissionRequiredTools = allTools.filter((t) => needsPermission(t.name));

// 按名称导出
export { Bash, BashOutput, KillShell, Read, Write, Glob, Grep, Edit, LS, TodoWrite, WebSearch, WebFetch, Location, Weather, MemorySave, MemorySearch };
export { ExitPlanMode, SavePlan, ReadPlan, setPreviousModeBeforePlan, getPreviousModeBeforePlan };

// 导出 todo 辅助函数
export { getTodos, setTodos, clearTodos, formatTodosForPrompt };

// 导出工具元数据和辅助函数
export {
  TOOL_METADATA,
  SENSITIVE_TOOLS,
  MAX_TOOL_CONCURRENCY,
  getToolMetadata,
  getToolDescriptions,
  isReadOnlyTool,
  isConcurrencySafeTool,
  needsPermission,
  canRunToolsConcurrently,
};

// Tool descriptions derived from TOOL_METADATA (single source of truth)
export const toolDescriptions = getToolDescriptions();
