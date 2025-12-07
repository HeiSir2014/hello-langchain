import { Bash, BashOutput, KillShell } from "./bash.js";
import { Read, Write, Glob, Grep, Edit, LS } from "./file.js";
import { TodoWrite, getTodos, setTodos, clearTodos, formatTodosForPrompt } from "./todo.js";
import { WebSearch, WebFetch } from "./web.js";
import { Location, Weather } from "./location.js";
import { ExitPlanMode, SavePlan, ReadPlan, setPreviousModeBeforePlan, getPreviousModeBeforePlan } from "./plan.js";
import {
  TOOL_METADATA,
  SENSITIVE_TOOLS,
  MAX_TOOL_CONCURRENCY,
  getToolMetadata,
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
export { Bash, BashOutput, KillShell, Read, Write, Glob, Grep, Edit, LS, TodoWrite, WebSearch, WebFetch, Location, Weather };
export { ExitPlanMode, SavePlan, ReadPlan, setPreviousModeBeforePlan, getPreviousModeBeforePlan };

// 导出 todo 辅助函数
export { getTodos, setTodos, clearTodos, formatTodosForPrompt };

// 导出工具元数据和辅助函数
export {
  TOOL_METADATA,
  SENSITIVE_TOOLS,
  MAX_TOOL_CONCURRENCY,
  getToolMetadata,
  isReadOnlyTool,
  isConcurrencySafeTool,
  needsPermission,
  canRunToolsConcurrently,
};

// 工具描述（用于帮助信息）
export const toolDescriptions = [
  { name: "Bash", description: "Execute shell commands (supports background execution)", readOnly: false },
  { name: "BashOutput", description: "Get output from background shell", readOnly: true },
  { name: "KillShell", description: "Kill a running background shell", readOnly: false },
  { name: "Read", description: "Read file contents (with line numbers)", readOnly: true },
  { name: "Write", description: "Write content to file", readOnly: false },
  { name: "Edit", description: "Edit file (string replacement)", readOnly: false },
  { name: "Glob", description: "File pattern matching search (e.g. **/*.ts)", readOnly: true },
  { name: "Grep", description: "Search text in file contents (ripgrep)", readOnly: true },
  { name: "LS", description: "List directory contents", readOnly: true },
  { name: "TodoWrite", description: "Manage task list for tracking progress", readOnly: false },
  { name: "WebSearch", description: "Search the web using DuckDuckGo", readOnly: true },
  { name: "WebFetch", description: "Fetch and analyze content from a URL", readOnly: true },
  { name: "Location", description: "Get current location based on IP address", readOnly: true },
  { name: "Weather", description: "Get weather information for a location in China", readOnly: true },
  { name: "ExitPlanMode", description: "Exit plan mode and return to normal mode (plan mode only)", readOnly: false, planModeOnly: true },
  { name: "SavePlan", description: "Save implementation plan to a markdown file", readOnly: false },
  { name: "ReadPlan", description: "Read an existing plan file", readOnly: true },
];
