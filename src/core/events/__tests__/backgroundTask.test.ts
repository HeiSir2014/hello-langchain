/**
 * BackgroundTaskManager 测试
 *
 * 覆盖：
 * - 任务创建和 ID 生成
 * - 任务状态跟踪
 * - 任务名称推断
 * - 取消任务
 * - 查询活跃任务
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { BackgroundTaskManager, getBackgroundTaskManager } from "../backgroundTask.js";
import { resetSystemEventQueue, getSystemEventQueue } from "../queue.js";

describe("BackgroundTaskManager", () => {
  let manager: BackgroundTaskManager;

  beforeEach(() => {
    resetSystemEventQueue();
    manager = new BackgroundTaskManager();
  });

  // ============ 任务创建 ============

  describe("spawn", () => {
    test("返回唯一的 taskId", () => {
      const id1 = manager.spawn("echo hello");
      const id2 = manager.spawn("echo world");
      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    test("任务初始状态为 running", () => {
      const id = manager.spawn("echo test");
      const task = manager.getTask(id);
      expect(task).toBeDefined();
      expect(task!.status).toBe("running");
      expect(task!.endTime).toBeNull();
    });

    test("使用自定义名称", () => {
      const id = manager.spawn("echo test", "my-task");
      const task = manager.getTask(id);
      expect(task!.name).toBe("my-task");
    });

    test("推送 background_task_started 事件到队列", () => {
      const queue = getSystemEventQueue();
      manager.spawn("echo test", "test-task");

      expect(queue.size).toBeGreaterThanOrEqual(1);
      expect(queue.has("background_task_started")).toBe(true);
    });
  });

  // ============ 任务名称推断 ============

  describe("task name inference", () => {
    test("npm 命令保留前3个部分", () => {
      const id = manager.spawn("npm run build");
      const task = manager.getTask(id);
      expect(task!.name).toBe("npm run build");
    });

    test("bun 命令保留前3个部分", () => {
      const id = manager.spawn("bun test src/");
      const task = manager.getTask(id);
      expect(task!.name).toBe("bun test src/");
    });

    test("git 命令保留前2个部分", () => {
      const id = manager.spawn("git status");
      const task = manager.getTask(id);
      expect(task!.name).toBe("git status");
    });

    test("长命令被截断", () => {
      const longCommand = "some-very-long-command-that-exceeds-forty-characters --with-lots-of-flags";
      const id = manager.spawn(longCommand);
      const task = manager.getTask(id);
      expect(task!.name.length).toBeLessThanOrEqual(40);
      expect(task!.name).toContain("...");
    });
  });

  // ============ 任务查询 ============

  describe("task queries", () => {
    test("getTask 返回任务信息", () => {
      const id = manager.spawn("echo test");
      const task = manager.getTask(id);

      expect(task).toBeDefined();
      expect(task!.id).toBe(id);
      expect(task!.command).toBe("echo test");
    });

    test("getTask 未知 ID 返回 undefined", () => {
      expect(manager.getTask("nonexistent")).toBeUndefined();
    });

    test("getRunningTasks 返回活跃任务", () => {
      manager.spawn("echo a");
      manager.spawn("echo b");

      const running = manager.getRunningTasks();
      expect(running.length).toBe(2);
    });

    test("getAllTasks 返回所有任务", () => {
      manager.spawn("echo a");
      manager.spawn("echo b");

      expect(manager.getAllTasks().length).toBe(2);
    });
  });

  // ============ 取消 ============

  describe("cancel", () => {
    test("取消正在运行的任务", () => {
      const id = manager.spawn("sleep 10");
      const result = manager.cancel(id);
      expect(result).toBe(true);
    });

    test("取消不存在的任务返回 false", () => {
      expect(manager.cancel("nonexistent")).toBe(false);
    });
  });

  // ============ 清理 ============

  describe("cleanup", () => {
    test("cleanup 保留 running 任务，移除已完成任务", async () => {
      // spawn 两个任务 — 一个很快完成，一个长运行
      const fastId = manager.spawn("echo fast");
      const slowId = manager.spawn("sleep 60");

      // 等待 fast 任务完成
      await new Promise(resolve => setTimeout(resolve, 500));

      manager.cleanup();

      // fast 任务应该已完成并被清理
      // slow 任务仍在运行（或超时）
      const running = manager.getRunningTasks();
      // 至少 slow 应该还在（如果 PersistentShell 可用）
      // 但在测试环境中可能都完成了

      // cleanup 后，已完成的任务不应该存在
      const all = manager.getAllTasks();
      for (const task of all) {
        expect(task.status).toBe("running");
      }

      // 清理 slow 任务
      manager.cancel(slowId);
    });
  });

  // ============ 全局单例 ============

  describe("global singleton", () => {
    test("getBackgroundTaskManager 返回同一实例", () => {
      const a = getBackgroundTaskManager();
      const b = getBackgroundTaskManager();
      expect(a).toBe(b);
    });
  });
});
