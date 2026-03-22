/**
 * Background Task Manager
 *
 * Claude Code pattern: 后台任务完成时主动通知 agent，而不是轮询。
 *
 * 工作流程：
 * ```
 * 1. Agent 调用 Bash(run_in_background=true)
 *    → BackgroundTaskManager.spawn(command)
 *    → 立即返回 taskId
 *    → Agent 收到 "task started" 消息，继续其他工作
 *
 * 2. 后台命令执行中...（不阻塞 agent）
 *
 * 3. 命令完成
 *    → BackgroundTaskManager 创建 BackgroundTaskCompletedEvent
 *    → enqueue(event, strategy: "notify")
 *    → SystemEventQueue.notifyCallback fires
 *    → 注入 HumanMessage 到 agent graph
 *    → Agent 自动恢复响应，处理后台结果
 * ```
 *
 * 关键设计：
 * - 不轮询：用 Promise.then() 在完成时触发回调
 * - 不阻塞：spawn 立即返回，命令异步执行
 * - 有状态：跟踪所有活跃任务，支持取消和查询
 */

import { PersistentShell } from "../utils/PersistentShell.js";
import { getSystemEventQueue, generateEventId } from "./queue.js";
import type { BackgroundTaskCompletedEvent, BackgroundTaskStartedEvent } from "./types.js";
import { log } from "../../logger.js";

// ============ 类型定义 ============

export interface BackgroundTask {
  id: string;
  name: string;
  command: string;
  startTime: number;
  /** null 表示仍在运行 */
  endTime: number | null;
  status: "running" | "completed" | "failed" | "cancelled";
  result?: string;
  abortController: AbortController;
}

// ============ Task Manager ============

export class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();

  /**
   * 启动后台任务
   *
   * 立即返回 taskId，命令在后台异步执行。
   * 完成时自动向 SystemEventQueue 推送 notify 事件。
   */
  spawn(command: string, name?: string): string {
    const taskId = generateEventId();
    const taskName = name || this.inferTaskName(command);
    const abortController = new AbortController();
    const startTime = Date.now();

    const task: BackgroundTask = {
      id: taskId,
      name: taskName,
      command,
      startTime,
      endTime: null,
      status: "running",
      abortController,
    };

    this.tasks.set(taskId, task);

    // 推送 "started" 事件到队列（passive queue，不触发 notify）
    const startEvent: BackgroundTaskStartedEvent = {
      id: generateEventId(),
      type: "background_task_started",
      source: "background_task",
      priority: "normal",
      timestamp: startTime,
      strategy: "queue",
      data: {
        taskId,
        taskName,
        command,
      },
    };
    getSystemEventQueue().enqueue(startEvent);

    log.info("Background task spawned", { taskId, taskName, command });

    // 异步执行，完成时推送 notify 事件
    this.executeAsync(task).catch(error => {
      log.error("Background task execution error (uncaught)", {
        taskId,
        error: error.message,
      });
    });

    return taskId;
  }

  /**
   * 异步执行命令并在完成时通知
   *
   * 关键：不轮询。Promise 完成时直接触发 notify。
   */
  private async executeAsync(task: BackgroundTask): Promise<void> {
    const startTime = task.startTime;
    let stdout = "";
    let stderr = "";

    try {
      const shell = PersistentShell.getInstance();
      const result = await shell.exec(
        task.command,
        task.abortController.signal,
        600000, // 10 分钟超时（后台任务可能较长）
        // 不需要 streaming callback — 后台任务不需要实时输出
      );

      stdout = result.stdout || "";
      stderr = result.stderr || "";

      const durationMs = Date.now() - startTime;
      const success = result.code === 0 && !result.interrupted;

      task.endTime = Date.now();
      task.status = success ? "completed" : "failed";
      task.result = success ? stdout : `Exit code ${result.code}\n${stderr}`;

      log.info("Background task completed", {
        taskId: task.id,
        taskName: task.name,
        success,
        durationMs,
        outputLength: (stdout + stderr).length,
      });

      // 推送 "completed" 事件 — strategy: "notify" 立即触发回调
      const completedEvent: BackgroundTaskCompletedEvent = {
        id: generateEventId(),
        type: "background_task_completed",
        source: "background_task",
        priority: "high",
        timestamp: Date.now(),
        strategy: "notify",
        data: {
          taskId: task.id,
          taskName: task.name,
          result: this.formatResult(stdout, stderr, result.code, result.interrupted),
          success,
          durationMs,
        },
      };

      getSystemEventQueue().enqueue(completedEvent);
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const isCancelled = task.abortController.signal.aborted;

      task.endTime = Date.now();
      task.status = isCancelled ? "cancelled" : "failed";
      task.result = isCancelled ? "Cancelled by user" : error.message;

      log.warn("Background task failed", {
        taskId: task.id,
        taskName: task.name,
        isCancelled,
        error: error.message,
        durationMs,
      });

      // 取消的任务不推送 notify（用户主动操作，不需要 agent 响应）
      if (!isCancelled) {
        const failEvent: BackgroundTaskCompletedEvent = {
          id: generateEventId(),
          type: "background_task_completed",
          source: "background_task",
          priority: "high",
          timestamp: Date.now(),
          strategy: "notify",
          data: {
            taskId: task.id,
            taskName: task.name,
            result: `Error: ${error.message}`,
            success: false,
            durationMs,
          },
        };
        getSystemEventQueue().enqueue(failEvent);
      }
    }
  }

  /**
   * 取消后台任务
   */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running") return false;

    task.abortController.abort();
    log.info("Background task cancelled", { taskId, taskName: task.name });
    return true;
  }

  /**
   * 获取任务状态
   */
  getTask(taskId: string): Readonly<BackgroundTask> | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有活跃（running）任务
   */
  getRunningTasks(): Readonly<BackgroundTask>[] {
    return Array.from(this.tasks.values()).filter(t => t.status === "running");
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): Readonly<BackgroundTask>[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 清理已完成的任务记录
   */
  cleanup(): void {
    for (const [id, task] of this.tasks) {
      if (task.status !== "running") {
        this.tasks.delete(id);
      }
    }
  }

  /**
   * 从命令推断任务名称
   */
  private inferTaskName(command: string): string {
    const parts = command.trim().split(/\s+/);
    const base = parts[0] || "task";

    // 常见的命令模式
    if (base === "npm" || base === "bun" || base === "yarn" || base === "pnpm") {
      return parts.slice(0, 3).join(" ");
    }
    if (base === "git") {
      return parts.slice(0, 2).join(" ");
    }
    if (base === "docker") {
      return parts.slice(0, 3).join(" ");
    }

    // 截断过长的命令
    const shortCommand = command.length > 40 ? command.slice(0, 37) + "..." : command;
    return shortCommand;
  }

  /**
   * 格式化命令输出
   */
  private formatResult(stdout: string, stderr: string, exitCode: number, interrupted: boolean): string {
    const parts: string[] = [];

    if (stdout.trim()) {
      const trimmed = stdout.trim();
      if (trimmed.length > 5000) {
        parts.push(trimmed.slice(0, 2000) + "\n\n... [truncated] ...\n\n" + trimmed.slice(-2000));
      } else {
        parts.push(trimmed);
      }
    }

    if (stderr.trim()) {
      parts.push(`stderr: ${stderr.trim()}`);
    }

    if (interrupted) {
      parts.push("<interrupted>");
    }

    if (exitCode !== 0 && !interrupted) {
      parts.push(`Exit code: ${exitCode}`);
    }

    return parts.join("\n") || "(no output)";
  }
}

// ============ 全局单例 ============

let globalManager: BackgroundTaskManager | null = null;

export function getBackgroundTaskManager(): BackgroundTaskManager {
  if (!globalManager) {
    globalManager = new BackgroundTaskManager();
  }
  return globalManager;
}
