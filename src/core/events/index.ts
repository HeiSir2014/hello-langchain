/**
 * Events Module - 系统事件队列 + 后台任务通知
 *
 * 参考：
 * - OpenClaw: system events + priority queue + drain pattern
 * - Claude Code: background task notification (非轮询)
 *
 * 两种模式：
 * 1. Passive Queue: events 积累 → agent 每轮 drain → 注入上下文
 * 2. Active Notify: task 完成 → callback 触发 → inject message → agent 恢复
 */

export {
  SystemEventQueue,
  getSystemEventQueue,
  resetSystemEventQueue,
  generateEventId,
  type QueueConfig,
} from "./queue.js";

export {
  BackgroundTaskManager,
  getBackgroundTaskManager,
  type BackgroundTask,
} from "./backgroundTask.js";

export {
  type SystemEvent,
  type SystemEventType,
  type EventPriority,
  type EventSource,
  type NotifyCallback,
  type BackgroundTaskCompletedEvent,
  type BackgroundTaskStartedEvent,
  type FileChangedEvent,
  type ContextUpdateEvent,
  type TimerEvent,
  EVENT_PRIORITY_ORDER,
} from "./types.js";
