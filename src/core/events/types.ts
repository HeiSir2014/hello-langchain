/**
 * System Event Types
 *
 * 参考 OpenClaw 的 system event 架构 + Claude Code 的 background notification 模式。
 *
 * 两种通知机制：
 * 1. **Passive Queue** (OpenClaw pattern):
 *    events 在 queue 中积累，agent 在每轮开始时 drain queue 注入上下文。
 *    适用于非紧急事件：file_changed, reminder, context_update
 *
 * 2. **Active Notification** (Claude Code pattern):
 *    background task 完成时主动注入 HumanMessage 触发 agent 继续响应。
 *    适用于需要 agent 立即反应的事件：background_task_completed
 *    关键：不轮询，完成时回调触发。
 */

/** 事件优先级 */
export type EventPriority = "critical" | "high" | "normal" | "low";

/** 事件来源 */
export type EventSource =
  | "background_task"  // 后台任务完成
  | "file_watcher"     // 文件变更检测
  | "timer"            // 定时器触发
  | "user_action"      // 用户操作（非聊天）
  | "system"           // 系统级事件
  | "agent";           // agent 子任务

/** 系统事件基础接口 */
export interface SystemEvent {
  /** 唯一事件 ID */
  id: string;
  /** 事件类型（discriminated union tag） */
  type: string;
  /** 事件来源 */
  source: EventSource;
  /** 优先级 */
  priority: EventPriority;
  /** 创建时间戳 (ms) */
  timestamp: number;
  /** 事件数据 */
  data: Record<string, unknown>;
  /**
   * 通知策略：
   * - "queue": 被动入队，等 agent 下轮 drain（默认）
   * - "notify": 主动通知，立即触发 agent 响应
   */
  strategy: "queue" | "notify";
}

// ============ 具体事件类型 ============

/** 后台任务完成事件 (Claude Code pattern: notify) */
export interface BackgroundTaskCompletedEvent extends SystemEvent {
  type: "background_task_completed";
  source: "background_task";
  strategy: "notify";
  data: {
    taskId: string;
    taskName: string;
    result: string;
    success: boolean;
    durationMs: number;
  };
}

/** 后台任务启动事件 */
export interface BackgroundTaskStartedEvent extends SystemEvent {
  type: "background_task_started";
  source: "background_task";
  strategy: "queue";
  data: {
    taskId: string;
    taskName: string;
    command?: string;
  };
}

/** 文件变更事件 */
export interface FileChangedEvent extends SystemEvent {
  type: "file_changed";
  source: "file_watcher";
  strategy: "queue";
  data: {
    filePath: string;
    changeType: "created" | "modified" | "deleted";
  };
}

/** 上下文更新事件（如 CLAUDE.md 被修改） */
export interface ContextUpdateEvent extends SystemEvent {
  type: "context_update";
  source: "system";
  strategy: "queue";
  data: {
    contextType: string;
    summary: string;
  };
}

/** 定时器触发事件 */
export interface TimerEvent extends SystemEvent {
  type: "timer_fired";
  source: "timer";
  strategy: "queue";
  data: {
    timerId: string;
    timerName: string;
  };
}

/** 所有系统事件的联合类型 */
export type SystemEventType =
  | BackgroundTaskCompletedEvent
  | BackgroundTaskStartedEvent
  | FileChangedEvent
  | ContextUpdateEvent
  | TimerEvent;

/** 优先级排序权重 */
export const EVENT_PRIORITY_ORDER: Record<EventPriority, number> = {
  critical: 400,
  high: 300,
  normal: 200,
  low: 100,
};

/** 事件通知回调 */
export type NotifyCallback = (event: SystemEvent) => void;
