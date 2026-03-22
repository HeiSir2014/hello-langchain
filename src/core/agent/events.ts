import { EventEmitter } from 'events';

// ============ Event Data Types ============

export interface ToolConfirmation {
  name: string;
  args: Record<string, unknown>;
  toolCallId: string;
  /** For Bash tools, the command prefix (e.g., "npm", "git") */
  commandPrefix?: string | null;
}

export interface ToolProgress {
  name: string;
  id: string;
  message: string;
  percentage?: number;
  siblingIds?: string[];
}

// ============ Typed Event Map ============

/**
 * Strongly-typed event map for agent events.
 * Each key is an event type, value is the payload shape.
 */
export interface AgentEventMap {
  thinking: { model: string };
  streaming: { content: string; delta: string };
  tool_use: { name: string; args: Record<string, unknown>; id: string };
  tool_progress: { name: string; id: string; message: string; percentage?: number; siblingIds?: string[] };
  tool_result: { name: string; result: string; id: string; isError?: boolean };
  response: { content: string };
  error: { message: string };
  confirm_required: { tools: ToolConfirmation[] };
  compacting: { tokenCount?: number };
  auto_compact: { messagesBefore: number; messagesAfter: number; summary?: string };
  token_usage: { tokenCount: number; contextLimit: number; percentUsed: number };
  background_task: { taskId: string; taskName: string; status: 'started' | 'completed' | 'failed'; result?: string };
  done: { interrupted?: boolean };
}

/**
 * Union type of all agent events (discriminated by `type` field).
 */
export type AgentEventType = {
  [K in keyof AgentEventMap]: { type: K } & AgentEventMap[K];
}[keyof AgentEventMap];

/**
 * Extract event data for a specific event type.
 */
export type AgentEventData<T extends keyof AgentEventMap> = AgentEventMap[T];

// ============ Typed Event Emitter ============

class AgentEventEmitter extends EventEmitter {
  emit(event: 'agent', data: AgentEventType): boolean {
    return super.emit('agent', data);
  }

  on(event: 'agent', listener: (data: AgentEventType) => void): this {
    return super.on(event, listener);
  }

  off(event: 'agent', listener: (data: AgentEventType) => void): this {
    return super.off(event, listener);
  }
}

export const agentEvents = new AgentEventEmitter();

// Convenience methods
export const emitThinking = (model: string) =>
  agentEvents.emit('agent', { type: 'thinking', model });

export const emitStreaming = (content: string, delta: string) =>
  agentEvents.emit('agent', { type: 'streaming', content, delta });

export const emitToolUse = (name: string, args: Record<string, unknown>, id: string) =>
  agentEvents.emit('agent', { type: 'tool_use', name, args, id });

export const emitToolProgress = (name: string, id: string, message: string, percentage?: number, siblingIds?: string[]) =>
  agentEvents.emit('agent', { type: 'tool_progress', name, id, message, percentage, siblingIds });

export const emitToolResult = (name: string, result: string, id: string, isError = false) =>
  agentEvents.emit('agent', { type: 'tool_result', name, result, id, isError });

export const emitResponse = (content: string) =>
  agentEvents.emit('agent', { type: 'response', content });

export const emitError = (message: string) =>
  agentEvents.emit('agent', { type: 'error', message });

export const emitConfirmRequired = (tools: ToolConfirmation[]) =>
  agentEvents.emit('agent', { type: 'confirm_required', tools });

export const emitCompacting = (tokenCount?: number) =>
  agentEvents.emit('agent', { type: 'compacting', tokenCount });

export const emitAutoCompact = (messagesBefore: number, messagesAfter: number, summary?: string) =>
  agentEvents.emit('agent', { type: 'auto_compact', messagesBefore, messagesAfter, summary });

export const emitTokenUsage = (tokenCount: number, contextLimit: number, percentUsed: number) =>
  agentEvents.emit('agent', { type: 'token_usage', tokenCount, contextLimit, percentUsed });

export const emitBackgroundTask = (taskId: string, taskName: string, status: 'started' | 'completed' | 'failed', result?: string) =>
  agentEvents.emit('agent', { type: 'background_task', taskId, taskName, status, result });

export const emitDone = (interrupted = false) =>
  agentEvents.emit('agent', { type: 'done', interrupted });

// ============ Tool Abort Support ============
// Global AbortController for tool cancellation
// This allows tools to check if the current request has been aborted

let currentToolAbortController: AbortController | null = null;

// Current tool call IDs for progress events
let currentToolCallIds: Map<string, string> = new Map(); // toolName -> toolCallId

/**
 * Set the current tool call ID for a tool
 */
export function setCurrentToolCallId(toolName: string, toolCallId: string): void {
  currentToolCallIds.set(toolName, toolCallId);
}

/**
 * Get the current tool call ID for a tool
 */
export function getCurrentToolCallId(toolName: string): string | null {
  return currentToolCallIds.get(toolName) || null;
}

/**
 * Clear all tool call IDs
 */
export function clearToolCallIds(): void {
  currentToolCallIds.clear();
}

/**
 * Create a new AbortController for the current tool execution
 * Called by the agent before starting tool execution
 */
export function createToolAbortController(): AbortController {
  currentToolAbortController = new AbortController();
  return currentToolAbortController;
}

/**
 * Get the current AbortController signal
 * Tools can use this to check if they should abort
 */
export function getToolAbortSignal(): AbortSignal | null {
  return currentToolAbortController?.signal ?? null;
}

/**
 * Abort the current tool execution
 */
export function abortToolExecution(): boolean {
  if (currentToolAbortController && !currentToolAbortController.signal.aborted) {
    currentToolAbortController.abort();
    return true;
  }
  return false;
}

/**
 * Check if the current tool execution is aborted
 */
export function isToolAborted(): boolean {
  return currentToolAbortController?.signal?.aborted ?? false;
}

/**
 * Clear the current AbortController
 * Called when tool execution is complete
 */
export function clearToolAbortController(): void {
  currentToolAbortController = null;
}
