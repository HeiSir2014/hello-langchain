import { Bash, BashOutput, KillShell } from "./bash.js";
import { Read, Write, Glob, Grep, Edit, LS } from "./file.js";
import { TodoWrite, getTodos, setTodos, clearTodos, formatTodosForPrompt } from "./todo.js";

// 导出所有工具
export const tools = [Bash, BashOutput, KillShell, Read, Write, Glob, Grep, Edit, LS, TodoWrite];

// 按名称导出
export { Bash, BashOutput, KillShell, Read, Write, Glob, Grep, Edit, LS, TodoWrite };

// 导出 todo 辅助函数
export { getTodos, setTodos, clearTodos, formatTodosForPrompt };

// 工具描述（用于帮助信息）
export const toolDescriptions = [
  { name: "Bash", description: "Execute shell commands (supports background execution)" },
  { name: "BashOutput", description: "Get output from background shell" },
  { name: "KillShell", description: "Kill a running background shell" },
  { name: "Read", description: "Read file contents (with line numbers)" },
  { name: "Write", description: "Write content to file" },
  { name: "Edit", description: "Edit file (string replacement)" },
  { name: "Glob", description: "File pattern matching search (e.g. **/*.ts)" },
  { name: "Grep", description: "Search text in file contents (ripgrep)" },
  { name: "LS", description: "List directory contents" },
  { name: "TodoWrite", description: "Manage task list for tracking progress" },
];
