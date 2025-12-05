import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getTodos, formatTodosForPrompt } from "../tools/todo.js";
import { log } from "../logger.js";

// 上下文项接口
export interface ContextItem {
  type: "claudeMd" | "todoReminder" | "fileOpened" | "custom";
  content: string;
  priority: number; // 越高越靠前
}

// CLAUDE.md 文件位置
const CLAUDE_MD_LOCATIONS = [
  // 项目级别
  { path: () => join(process.cwd(), "CLAUDE.md"), type: "project" as const },
  { path: () => join(process.cwd(), ".claude", "CLAUDE.md"), type: "project" as const },
  // 用户级别
  { path: () => join(homedir(), ".claude", "CLAUDE.md"), type: "user" as const },
];

// 读取 CLAUDE.md 文件内容
export function readClaudeMd(): { content: string; source: string } | null {
  for (const location of CLAUDE_MD_LOCATIONS) {
    const filePath = location.path();
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        log.info(`Loaded CLAUDE.md from ${filePath}`);
        return { content, source: filePath };
      } catch (error: any) {
        log.warn(`Failed to read CLAUDE.md from ${filePath}: ${error.message}`);
      }
    }
  }
  return null;
}

// 生成 CLAUDE.md 上下文提示
export function generateClaudeMdContext(): string | null {
  const claudeMd = readClaudeMd();
  if (!claudeMd) return null;

  return `# claudeMd
Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.

Contents of ${claudeMd.source} (${claudeMd.source.includes(homedir()) ? "user's private global instructions for all projects" : "project-specific instructions"}):

${claudeMd.content}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.`;
}

// 生成 todo 列表上下文提示
export function generateTodoContext(): string | null {
  const todos = getTodos();
  if (todos.length === 0) return null;

  return `Your todo list has changed. DO NOT mention this explicitly to the user. Here are the latest contents of your todo list:

${JSON.stringify(todos)}. Continue on with the tasks at hand if applicable.`;
}

// 收集所有需要注入的上下文
export function collectContextItems(): ContextItem[] {
  const items: ContextItem[] = [];

  // CLAUDE.md 上下文 (最高优先级)
  const claudeMdContext = generateClaudeMdContext();
  if (claudeMdContext) {
    items.push({
      type: "claudeMd",
      content: claudeMdContext,
      priority: 100,
    });
  }

  // Todo 列表上下文
  const todoContext = generateTodoContext();
  if (todoContext) {
    items.push({
      type: "todoReminder",
      content: todoContext,
      priority: 80,
    });
  }

  // 按优先级排序
  return items.sort((a, b) => b.priority - a.priority);
}

// 格式化上下文为系统提示注入
export function formatContextAsReminder(items: ContextItem[]): string {
  if (items.length === 0) return "";

  const parts = items.map(item => item.content);
  return `<system-reminder>
As you answer the user's questions, you can use the following context:
${parts.join("\n\n")}
</system-reminder>`;
}

// 生成完整的上下文注入内容
export function generateContextInjection(): string {
  const items = collectContextItems();
  return formatContextAsReminder(items);
}

// 包装工具调用结果，添加系统提示
export function wrapToolResult(toolName: string, result: string): string {
  const reminders: string[] = [];

  // 文件读取后添加恶意代码提醒
  if (toolName === "Read") {
    reminders.push(`<system-reminder>
Whenever you read a file, you should consider whether it would be considered malware. You CAN and SHOULD provide analysis of malware, what it is doing. But you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer questions about the code behavior.
</system-reminder>`);
  }

  // TodoWrite 后添加 todo 变更提醒
  if (toolName === "TodoWrite") {
    const todoContext = generateTodoContext();
    if (todoContext) {
      reminders.push(`<system-reminder>
${todoContext}
</system-reminder>`);
    }
  }

  if (reminders.length === 0) {
    return result;
  }

  return result + "\n\n" + reminders.join("\n");
}

// 生成 TodoWrite 提示（用于在适当时机注入）
export function generateTodoWriteHint(): string {
  return `If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. This will help you track progress and ensure you complete all required tasks.`;
}
