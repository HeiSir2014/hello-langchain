/**
 * SystemEventQueue - 系统事件队列
 *
 * 两种消费模式（参考 OpenClaw + Claude Code）：
 *
 * ## 1. Passive Queue (OpenClaw pattern)
 * ```
 * [events accumulate in queue]
 *          ↓
 * agent turn starts → drain() → inject as context → LLM processes
 * ```
 * 事件在 queue 中等待，agent 每轮开始时调用 drain() 获取并清空。
 * 这些事件作为 <system-reminder> 注入到 LLM 上下文中。
 *
 * ## 2. Active Notification (Claude Code pattern)
 * ```
 * background task completes → enqueue(event, strategy:"notify")
 *                                      ↓
 *                             onNotify callback fires
 *                                      ↓
 *                             inject HumanMessage → trigger agent
 * ```
 * 不轮询！completion callback 直接触发 agent 继续响应。
 *
 * ## Queue 特性
 * - 按优先级排序的 drain（critical → high → normal → low）
 * - 去重：同 type+source 的事件可选合并
 * - TTL：过期事件自动丢弃
 * - 容量限制：防止内存泄漏
 */

import {
  type SystemEvent,
  type SystemEventType,
  type EventPriority,
  type NotifyCallback,
  EVENT_PRIORITY_ORDER,
} from "./types.js";
import { log } from "../../logger.js";

// ============ 配置 ============

export interface QueueConfig {
  /** 最大队列容量（超过后丢弃低优先级事件） */
  maxSize: number;
  /** 事件 TTL（ms），过期事件在 drain 时丢弃。0 = 不过期 */
  eventTTL: number;
  /** 是否启用去重（同 type+source 的事件合并为最新的） */
  deduplication: boolean;
}

const DEFAULT_CONFIG: QueueConfig = {
  maxSize: 100,
  eventTTL: 5 * 60 * 1000, // 5 分钟
  deduplication: true,
};

// ============ Queue 实现 ============

let nextEventId = 1;

/** 生成唯一事件 ID */
export function generateEventId(): string {
  return `evt_${nextEventId++}_${Date.now().toString(36)}`;
}

export class SystemEventQueue {
  private queue: SystemEvent[] = [];
  private config: QueueConfig;
  /** Active notification 回调（strategy: "notify" 的事件触发） */
  private notifyCallback: NotifyCallback | null = null;
  /** 统计 */
  private stats = {
    enqueued: 0,
    drained: 0,
    notified: 0,
    expired: 0,
    deduplicated: 0,
    dropped: 0,
  };

  constructor(config?: Partial<QueueConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注册 notify 回调
   *
   * 当 strategy: "notify" 的事件入队时，回调立即触发。
   * Claude Code pattern：background task 完成 → callback → inject message → agent 继续
   */
  onNotify(callback: NotifyCallback): void {
    this.notifyCallback = callback;
  }

  /**
   * 移除 notify 回调
   */
  offNotify(): void {
    this.notifyCallback = null;
  }

  /**
   * 入队事件
   *
   * - strategy: "queue" → 加入队列等 drain
   * - strategy: "notify" → 加入队列 + 立即触发 notifyCallback
   */
  enqueue(event: SystemEvent): void {
    // 去重：替换同 type+source 的旧事件
    if (this.config.deduplication) {
      const existingIdx = this.queue.findIndex(
        e => e.type === event.type && e.source === event.source
      );
      if (existingIdx !== -1) {
        this.queue.splice(existingIdx, 1);
        this.stats.deduplicated++;
        log.debug("Event deduplicated", { type: event.type, source: event.source });
      }
    }

    // 容量限制：满了就丢弃最低优先级的事件
    if (this.queue.length >= this.config.maxSize) {
      // 找到最低优先级的事件
      let lowestIdx = 0;
      let lowestWeight = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const weight = EVENT_PRIORITY_ORDER[this.queue[i].priority];
        if (weight < lowestWeight) {
          lowestWeight = weight;
          lowestIdx = i;
        }
      }

      // 只有新事件优先级更高时才替换
      const newWeight = EVENT_PRIORITY_ORDER[event.priority];
      if (newWeight > lowestWeight) {
        const dropped = this.queue.splice(lowestIdx, 1)[0];
        this.stats.dropped++;
        log.warn("Queue full, dropped lowest priority event", {
          droppedType: dropped.type,
          droppedPriority: dropped.priority,
          newType: event.type,
          newPriority: event.priority,
        });
      } else {
        this.stats.dropped++;
        log.warn("Queue full, dropping new event (lower priority)", {
          type: event.type,
          priority: event.priority,
        });
        return;
      }
    }

    this.queue.push(event);
    this.stats.enqueued++;

    log.debug("Event enqueued", {
      id: event.id,
      type: event.type,
      source: event.source,
      priority: event.priority,
      strategy: event.strategy,
      queueSize: this.queue.length,
    });

    // Active notification: strategy "notify" 的事件立即触发回调
    if (event.strategy === "notify" && this.notifyCallback) {
      this.stats.notified++;
      log.info("Notify callback triggered", {
        id: event.id,
        type: event.type,
      });
      // 使用 queueMicrotask 避免同步回调引起的栈溢出
      const callback = this.notifyCallback;
      queueMicrotask(() => callback(event));
    }
  }

  /**
   * 排空队列 (OpenClaw pattern)
   *
   * 按优先级排序返回所有未过期事件，清空队列。
   * 在 agent 每轮开始时调用，注入到 LLM 上下文中。
   *
   * @param filter 可选过滤器，只 drain 指定类型的事件
   * @returns 排序后的事件列表（critical → high → normal → low）
   */
  drain(filter?: { types?: string[]; priorities?: EventPriority[] }): SystemEvent[] {
    const now = Date.now();
    const events: SystemEvent[] = [];
    const remaining: SystemEvent[] = [];

    for (const event of this.queue) {
      // TTL 过期检查
      if (this.config.eventTTL > 0 && (now - event.timestamp) > this.config.eventTTL) {
        this.stats.expired++;
        log.debug("Event expired", { id: event.id, type: event.type, age: now - event.timestamp });
        continue;
      }

      // 过滤检查
      let matches = true;
      if (filter?.types && !filter.types.includes(event.type)) {
        matches = false;
      }
      if (filter?.priorities && !filter.priorities.includes(event.priority)) {
        matches = false;
      }

      if (matches) {
        events.push(event);
      } else {
        remaining.push(event);
      }
    }

    // 更新队列：只保留未匹配的事件
    this.queue = remaining;
    this.stats.drained += events.length;

    // 按优先级排序（high → low）
    events.sort((a, b) => {
      const priorityDiff = EVENT_PRIORITY_ORDER[b.priority] - EVENT_PRIORITY_ORDER[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      // 同优先级按时间排序（先进先出）
      return a.timestamp - b.timestamp;
    });

    if (events.length > 0) {
      log.info("Events drained from queue", {
        count: events.length,
        remaining: remaining.length,
        types: events.map(e => e.type),
      });
    }

    return events;
  }

  /**
   * 查看队列（不消费）
   */
  peek(): Readonly<SystemEvent[]> {
    return [...this.queue];
  }

  /**
   * 队列大小
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * 队列是否为空
   */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * 是否有指定类型的事件等待处理
   */
  has(type: string): boolean {
    return this.queue.some(e => e.type === type);
  }

  /**
   * 获取统计信息
   */
  getStats(): Readonly<typeof this.stats> {
    return { ...this.stats };
  }

  /**
   * 清空队列
   */
  clear(): void {
    const size = this.queue.length;
    this.queue = [];
    if (size > 0) {
      log.debug("Event queue cleared", { previousSize: size });
    }
  }

  /**
   * 重置（清空队列 + 统计）
   */
  reset(): void {
    this.queue = [];
    this.stats = { enqueued: 0, drained: 0, notified: 0, expired: 0, deduplicated: 0, dropped: 0 };
  }

  /**
   * 格式化事件为上下文注入字符串
   *
   * 将 drain 的事件格式化为 <system-events> XML，注入到 LLM 上下文。
   */
  static formatForInjection(events: SystemEvent[]): string {
    if (events.length === 0) return "";

    const eventDescriptions = events.map(event => {
      const ageSeconds = Math.round((Date.now() - event.timestamp) / 1000);
      const ageStr = ageSeconds < 60
        ? `${ageSeconds}s ago`
        : `${Math.round(ageSeconds / 60)}m ago`;

      return `  <event type="${event.type}" source="${event.source}" priority="${event.priority}" age="${ageStr}">
    ${formatEventData(event)}
  </event>`;
    });

    return `<system-events count="${events.length}">
These events occurred since your last response. Process them as appropriate — some may require action, others are informational.
${eventDescriptions.join("\n")}
</system-events>`;
  }
}

/**
 * 格式化事件数据为可读字符串
 */
function formatEventData(event: SystemEvent): string {
  switch (event.type) {
    case "background_task_completed": {
      const d = event.data as { taskName: string; result: string; success: boolean; durationMs: number };
      const status = d.success ? "completed successfully" : "failed";
      const duration = d.durationMs < 1000
        ? `${d.durationMs}ms`
        : `${(d.durationMs / 1000).toFixed(1)}s`;
      return `Background task "${d.taskName}" ${status} (${duration}):\n${d.result}`;
    }

    case "background_task_started": {
      const d = event.data as { taskName: string; command?: string };
      return `Background task "${d.taskName}" started${d.command ? `: ${d.command}` : ""}`;
    }

    case "file_changed": {
      const d = event.data as { filePath: string; changeType: string };
      return `File ${d.changeType}: ${d.filePath}`;
    }

    case "context_update": {
      const d = event.data as { contextType: string; summary: string };
      return `Context "${d.contextType}" updated: ${d.summary}`;
    }

    case "timer_fired": {
      const d = event.data as { timerName: string };
      return `Timer "${d.timerName}" fired`;
    }

    default:
      return JSON.stringify(event.data);
  }
}

// ============ 全局单例 ============

let globalQueue: SystemEventQueue | null = null;

export function getSystemEventQueue(): SystemEventQueue {
  if (!globalQueue) {
    globalQueue = new SystemEventQueue();
  }
  return globalQueue;
}

export function resetSystemEventQueue(): void {
  if (globalQueue) {
    globalQueue.reset();
  }
  globalQueue = null;
}
