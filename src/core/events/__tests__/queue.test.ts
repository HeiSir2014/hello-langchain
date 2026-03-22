/**
 * SystemEventQueue 测试
 *
 * 覆盖：
 * - 入队/出队
 * - 优先级排序
 * - 去重
 * - TTL 过期
 * - 容量限制
 * - Active notification (notify 策略)
 * - Passive drain (queue 策略)
 * - 事件格式化
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { SystemEventQueue, generateEventId, resetSystemEventQueue, getSystemEventQueue } from "../queue.js";
import type { SystemEvent } from "../types.js";

// Helper: 创建测试事件
function createEvent(overrides?: Partial<SystemEvent>): SystemEvent {
  return {
    id: generateEventId(),
    type: "test_event",
    source: "system",
    priority: "normal",
    timestamp: Date.now(),
    strategy: "queue",
    data: {},
    ...overrides,
  };
}

describe("SystemEventQueue", () => {
  let queue: SystemEventQueue;

  beforeEach(() => {
    resetSystemEventQueue();
    queue = new SystemEventQueue({ eventTTL: 0, deduplication: false });
  });

  // ============ 基本入队/出队 ============

  describe("enqueue and drain", () => {
    test("入队后 drain 获取事件", () => {
      const event = createEvent();
      queue.enqueue(event);

      expect(queue.size).toBe(1);
      expect(queue.isEmpty).toBe(false);

      const drained = queue.drain();
      expect(drained).toHaveLength(1);
      expect(drained[0].id).toBe(event.id);

      expect(queue.size).toBe(0);
      expect(queue.isEmpty).toBe(true);
    });

    test("空队列 drain 返回空数组", () => {
      const drained = queue.drain();
      expect(drained).toHaveLength(0);
    });

    test("多个事件按顺序入队", () => {
      const e1 = createEvent({ data: { order: 1 } });
      const e2 = createEvent({ data: { order: 2 } });
      const e3 = createEvent({ data: { order: 3 } });

      queue.enqueue(e1);
      queue.enqueue(e2);
      queue.enqueue(e3);

      expect(queue.size).toBe(3);
      const drained = queue.drain();
      expect(drained).toHaveLength(3);
    });

    test("drain 后队列为空", () => {
      queue.enqueue(createEvent());
      queue.enqueue(createEvent());
      queue.drain();
      expect(queue.isEmpty).toBe(true);
    });
  });

  // ============ 优先级排序 ============

  describe("priority ordering", () => {
    test("drain 按优先级排序（high → normal → low）", () => {
      queue.enqueue(createEvent({ priority: "low", data: { order: "low" } }));
      queue.enqueue(createEvent({ priority: "high", data: { order: "high" } }));
      queue.enqueue(createEvent({ priority: "normal", data: { order: "normal" } }));
      queue.enqueue(createEvent({ priority: "critical", data: { order: "critical" } }));

      const drained = queue.drain();
      expect(drained).toHaveLength(4);
      expect(drained[0].priority).toBe("critical");
      expect(drained[1].priority).toBe("high");
      expect(drained[2].priority).toBe("normal");
      expect(drained[3].priority).toBe("low");
    });

    test("同优先级按时间排序（FIFO）", () => {
      const e1 = createEvent({ priority: "normal", timestamp: 1000, data: { order: 1 } });
      const e2 = createEvent({ priority: "normal", timestamp: 2000, data: { order: 2 } });
      const e3 = createEvent({ priority: "normal", timestamp: 3000, data: { order: 3 } });

      queue.enqueue(e3);
      queue.enqueue(e1);
      queue.enqueue(e2);

      const drained = queue.drain();
      expect((drained[0].data as any).order).toBe(1);
      expect((drained[1].data as any).order).toBe(2);
      expect((drained[2].data as any).order).toBe(3);
    });
  });

  // ============ 去重 ============

  describe("deduplication", () => {
    test("启用去重时，同 type+source 替换旧事件", () => {
      const dedupQueue = new SystemEventQueue({ deduplication: true, eventTTL: 0, maxSize: 100 });

      dedupQueue.enqueue(createEvent({ type: "file_changed", source: "file_watcher", data: { v: 1 } }));
      dedupQueue.enqueue(createEvent({ type: "file_changed", source: "file_watcher", data: { v: 2 } }));

      expect(dedupQueue.size).toBe(1);
      const drained = dedupQueue.drain();
      expect((drained[0].data as any).v).toBe(2); // 保留最新的
    });

    test("不同 type 不去重", () => {
      const dedupQueue = new SystemEventQueue({ deduplication: true, eventTTL: 0, maxSize: 100 });

      dedupQueue.enqueue(createEvent({ type: "event_a" }));
      dedupQueue.enqueue(createEvent({ type: "event_b" }));

      expect(dedupQueue.size).toBe(2);
    });

    test("禁用去重时不合并", () => {
      queue.enqueue(createEvent({ type: "same_type", data: { v: 1 } }));
      queue.enqueue(createEvent({ type: "same_type", data: { v: 2 } }));

      expect(queue.size).toBe(2);
    });
  });

  // ============ TTL 过期 ============

  describe("TTL expiration", () => {
    test("过期事件在 drain 时被丢弃", () => {
      const ttlQueue = new SystemEventQueue({ eventTTL: 100, deduplication: false, maxSize: 100 }); // 100ms TTL

      ttlQueue.enqueue(createEvent({ timestamp: Date.now() - 200 })); // 已过期
      ttlQueue.enqueue(createEvent({ timestamp: Date.now() })); // 未过期

      const drained = ttlQueue.drain();
      expect(drained).toHaveLength(1);
    });

    test("TTL=0 时不过期", () => {
      queue.enqueue(createEvent({ timestamp: Date.now() - 999999 }));
      const drained = queue.drain();
      expect(drained).toHaveLength(1);
    });
  });

  // ============ 容量限制 ============

  describe("capacity limit", () => {
    test("队列满时丢弃最低优先级事件", () => {
      const smallQueue = new SystemEventQueue({ maxSize: 2, eventTTL: 0, deduplication: false });

      smallQueue.enqueue(createEvent({ priority: "low" }));
      smallQueue.enqueue(createEvent({ priority: "normal" }));

      // 队列已满，插入 high 优先级应丢弃 low
      smallQueue.enqueue(createEvent({ priority: "high" }));
      expect(smallQueue.size).toBe(2);

      const drained = smallQueue.drain();
      expect(drained[0].priority).toBe("high");
      expect(drained[1].priority).toBe("normal");
    });

    test("新事件优先级更低时被丢弃", () => {
      const smallQueue = new SystemEventQueue({ maxSize: 2, eventTTL: 0, deduplication: false });

      smallQueue.enqueue(createEvent({ priority: "high" }));
      smallQueue.enqueue(createEvent({ priority: "normal" }));

      // 新事件 low 优先级更低 → 被丢弃
      smallQueue.enqueue(createEvent({ priority: "low" }));
      expect(smallQueue.size).toBe(2);
    });
  });

  // ============ Active Notification ============

  describe("notify strategy", () => {
    test("strategy:notify 触发 onNotify 回调", async () => {
      let notifiedEvent: SystemEvent | null = null;

      queue.onNotify((event) => {
        notifiedEvent = event;
      });

      queue.enqueue(createEvent({ strategy: "notify" }));

      // queueMicrotask 异步触发
      await new Promise(resolve => queueMicrotask(resolve));

      expect(notifiedEvent).not.toBeNull();
      expect(notifiedEvent!.strategy).toBe("notify");
    });

    test("strategy:queue 不触发 onNotify", async () => {
      let notified = false;

      queue.onNotify(() => { notified = true; });
      queue.enqueue(createEvent({ strategy: "queue" }));

      await new Promise(resolve => queueMicrotask(resolve));
      expect(notified).toBe(false);
    });

    test("无回调时 notify 事件正常入队", () => {
      queue.enqueue(createEvent({ strategy: "notify" }));
      expect(queue.size).toBe(1);
    });

    test("offNotify 移除回调", async () => {
      let notified = false;
      queue.onNotify(() => { notified = true; });
      queue.offNotify();

      queue.enqueue(createEvent({ strategy: "notify" }));
      await new Promise(resolve => queueMicrotask(resolve));
      expect(notified).toBe(false);
    });
  });

  // ============ 过滤 drain ============

  describe("filtered drain", () => {
    test("按 type 过滤", () => {
      queue.enqueue(createEvent({ type: "a" }));
      queue.enqueue(createEvent({ type: "b" }));
      queue.enqueue(createEvent({ type: "a" }));

      const drained = queue.drain({ types: ["a"] });
      expect(drained).toHaveLength(2);
      expect(queue.size).toBe(1); // "b" 仍在队列中
    });

    test("按 priority 过滤", () => {
      queue.enqueue(createEvent({ priority: "high" }));
      queue.enqueue(createEvent({ priority: "low" }));
      queue.enqueue(createEvent({ priority: "high" }));

      const drained = queue.drain({ priorities: ["high"] });
      expect(drained).toHaveLength(2);
      expect(queue.size).toBe(1);
    });
  });

  // ============ 辅助方法 ============

  describe("utility methods", () => {
    test("peek 不消费事件", () => {
      queue.enqueue(createEvent());
      const peeked = queue.peek();
      expect(peeked).toHaveLength(1);
      expect(queue.size).toBe(1); // 仍然在队列中
    });

    test("has 检查事件类型", () => {
      queue.enqueue(createEvent({ type: "file_changed" }));
      expect(queue.has("file_changed")).toBe(true);
      expect(queue.has("nonexistent")).toBe(false);
    });

    test("clear 清空队列", () => {
      queue.enqueue(createEvent());
      queue.enqueue(createEvent());
      queue.clear();
      expect(queue.isEmpty).toBe(true);
    });

    test("reset 清空队列和统计", () => {
      queue.enqueue(createEvent());
      queue.drain();
      const stats = queue.getStats();
      expect(stats.enqueued).toBe(1);

      queue.reset();
      const resetStats = queue.getStats();
      expect(resetStats.enqueued).toBe(0);
      expect(resetStats.drained).toBe(0);
    });
  });

  // ============ 格式化输出 ============

  describe("formatForInjection", () => {
    test("空事件返回空字符串", () => {
      expect(SystemEventQueue.formatForInjection([])).toBe("");
    });

    test("格式化为 XML 结构", () => {
      const events = [
        createEvent({
          type: "background_task_completed",
          source: "background_task",
          priority: "high",
          data: {
            taskName: "bun test",
            result: "All tests passed",
            success: true,
            durationMs: 1500,
          },
        }),
      ];

      const result = SystemEventQueue.formatForInjection(events);
      expect(result).toContain("<system-events count=\"1\">");
      expect(result).toContain("background_task_completed");
      expect(result).toContain("bun test");
      expect(result).toContain("completed successfully");
      expect(result).toContain("</system-events>");
    });

    test("多个事件按传入顺序格式化", () => {
      const events = [
        createEvent({ type: "file_changed", source: "file_watcher", data: { filePath: "src/app.ts", changeType: "modified" } }),
        createEvent({ type: "background_task_completed", source: "background_task", data: { taskName: "build", result: "OK", success: true, durationMs: 500 } }),
      ];

      const result = SystemEventQueue.formatForInjection(events);
      expect(result).toContain("count=\"2\"");
      expect(result).toContain("file_changed");
      expect(result).toContain("background_task_completed");
    });
  });

  // ============ 统计 ============

  describe("stats", () => {
    test("跟踪入队和出队数", () => {
      queue.enqueue(createEvent());
      queue.enqueue(createEvent());
      queue.drain();

      const stats = queue.getStats();
      expect(stats.enqueued).toBe(2);
      expect(stats.drained).toBe(2);
    });

    test("跟踪 notify 数", async () => {
      queue.onNotify(() => {});
      queue.enqueue(createEvent({ strategy: "notify" }));
      queue.enqueue(createEvent({ strategy: "queue" }));

      const stats = queue.getStats();
      expect(stats.notified).toBe(1);
    });
  });

  // ============ 全局单例 ============

  describe("global singleton", () => {
    test("getSystemEventQueue 返回同一实例", () => {
      const a = getSystemEventQueue();
      const b = getSystemEventQueue();
      expect(a).toBe(b);
    });

    test("resetSystemEventQueue 创建新实例", () => {
      const a = getSystemEventQueue();
      resetSystemEventQueue();
      const b = getSystemEventQueue();
      expect(a).not.toBe(b);
    });
  });
});
