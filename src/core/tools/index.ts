import { Bash, BashOutput, KillShell } from "./bash.js";
import { Read, Write, Glob, Grep, Edit, LS } from "./file.js";
import { TodoWrite, getTodos, setTodos, clearTodos, formatTodosForPrompt } from "./todo.js";
import { WebSearch, WebFetch } from "./web.js";
import { Location } from "./location.js";
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

// 导出所有工具
export const tools = [Bash, BashOutput, KillShell, Read, Write, Glob, Grep, Edit, LS, TodoWrite, WebSearch, WebFetch, Location];

// 获取只读工具（可并发执行）
export const readOnlyTools = tools.filter((t) => isReadOnlyTool(t.name));

// 获取需要权限的工具
export const permissionRequiredTools = tools.filter((t) => needsPermission(t.name));

// 按名称导出
export { Bash, BashOutput, KillShell, Read, Write, Glob, Grep, Edit, LS, TodoWrite, WebSearch, WebFetch, Location };

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
];
