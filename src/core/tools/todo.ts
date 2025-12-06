import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { log } from "../../logger.js";

// Todo 项的状态
export type TodoStatus = "pending" | "in_progress" | "completed";

// Todo 项接口
export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm: string;
}

// 存储当前会话的 todo 列表
let currentTodos: TodoItem[] = [];

// 获取当前 todo 列表
export function getTodos(): TodoItem[] {
  return [...currentTodos];
}

// 设置 todo 列表（用于测试或外部更新）
export function setTodos(todos: TodoItem[]): void {
  currentTodos = [...todos];
}

// 清空 todo 列表
export function clearTodos(): void {
  currentTodos = [];
}

// 格式化 todo 列表为字符串（用于注入到消息中）
export function formatTodosForPrompt(): string {
  if (currentTodos.length === 0) {
    return "Your todo list is currently empty.";
  }

  const formattedTodos = currentTodos.map((todo, index) => {
    const statusIcon =
      todo.status === "completed" ? "✓" :
      todo.status === "in_progress" ? "→" :
      "○";
    return `${statusIcon} ${todo.content} [${todo.status}]`;
  }).join("\n");

  return `Current todo list:\n${formattedTodos}`;
}

// 生成 todo 列表变更提示
export function generateTodoChangeReminder(): string {
  return `<system-reminder>
Your todo list has changed. DO NOT mention this explicitly to the user. Here are the latest contents of your todo list:

${JSON.stringify(currentTodos)}. Continue on with the tasks at hand if applicable.
</system-reminder>`;
}

// TodoWrite 工具 - 管理任务列表
export const TodoWrite = tool(
  async ({ todos }) => {
    const startTime = Date.now();
    log.toolStart("TodoWrite", { todoCount: todos.length });

    // 验证 todo 项
    for (const todo of todos) {
      if (!todo.content || todo.content.trim() === "") {
        return "Error: Todo content cannot be empty";
      }
      if (!["pending", "in_progress", "completed"].includes(todo.status)) {
        return `Error: Invalid status "${todo.status}". Must be one of: pending, in_progress, completed`;
      }
      if (!todo.activeForm || todo.activeForm.trim() === "") {
        return "Error: Todo activeForm cannot be empty";
      }
    }

    // 更新 todo 列表
    currentTodos = todos.map(todo => ({
      content: todo.content.trim(),
      status: todo.status as TodoStatus,
      activeForm: todo.activeForm.trim(),
    }));

    const summary = {
      total: currentTodos.length,
      pending: currentTodos.filter(t => t.status === "pending").length,
      in_progress: currentTodos.filter(t => t.status === "in_progress").length,
      completed: currentTodos.filter(t => t.status === "completed").length,
    };

    log.toolEnd("TodoWrite", Date.now() - startTime, currentTodos.length);

    // 返回更新后的状态摘要
    let result = `Todo list updated successfully.\n`;
    result += `Total: ${summary.total} | Pending: ${summary.pending} | In Progress: ${summary.in_progress} | Completed: ${summary.completed}`;

    if (currentTodos.length > 0) {
      result += "\n\nCurrent tasks:";
      currentTodos.forEach((todo, i) => {
        const statusIcon =
          todo.status === "completed" ? "✓" :
          todo.status === "in_progress" ? "→" :
          "○";
        result += `\n${i + 1}. ${statusIcon} ${todo.content} [${todo.status}]`;
      });
    }

    return result;
  },
  {
    name: "TodoWrite",
    description: `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work. Ideally you should only have one todo as in_progress at a time
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

   **IMPORTANT**: Task descriptions must have two forms:
   - content: The imperative form describing what needs to be done (e.g., "Run tests", "Build the project")
   - activeForm: The present continuous form shown during execution (e.g., "Running tests", "Building the project")

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Exactly ONE task must be in_progress at any time (not less, not more)
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - You couldn't find necessary files or dependencies

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names
   - Always provide both forms:
     - content: "Fix authentication bug"
     - activeForm: "Fixing authentication bug"

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.`,
    schema: z.object({
      todos: z.array(z.object({
        content: z.string().min(1).describe("The imperative form describing what needs to be done (e.g., \"Run tests\", \"Build the project\")"),
        status: z.enum(["pending", "in_progress", "completed"]).describe("Task status: pending, in_progress, or completed"),
        activeForm: z.string().min(1).describe("The present continuous form shown during execution (e.g., \"Running tests\", \"Building the project\")"),
      })).describe("The updated todo list"),
    }),
  }
);
