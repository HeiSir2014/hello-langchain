// Message types for UI
export type MessageType =
  | 'user'
  | 'assistant'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'system'
  | 'bash_input'
  | 'bash_output';

// Generate unique ID for messages
let messageIdCounter = 0;
export function generateMessageId(): string {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

export interface UserMessage {
  type: 'user';
  content: string;
  id?: string;
}

export interface AssistantMessage {
  type: 'assistant';
  content: string;
  id?: string;
}

export interface ToolUseMessage {
  type: 'tool_use';
  name: string;
  args: Record<string, unknown>;
  toolCallId: string;
  id?: string;
  // Streaming output - updated during execution
  streamingOutput?: string;
  // Result fields - populated when tool execution completes
  result?: string;
  isError?: boolean;
}

export interface ToolResultMessage {
  type: 'tool_result';
  name: string;
  result: string;
  isError?: boolean;
  toolCallId: string;
  id?: string;
}

export interface ErrorMessage {
  type: 'error';
  content: string;
  id?: string;
}

export interface SystemMessage {
  type: 'system';
  content: string;
  id?: string;
}

export interface BashInputMessage {
  type: 'bash_input';
  command: string;
  id?: string;
}

export interface BashOutputMessage {
  type: 'bash_output';
  stdout: string;
  stderr: string;
  exitCode?: number;
  isError?: boolean;
  id?: string;
}

export type MessageItem =
  | UserMessage
  | AssistantMessage
  | ToolUseMessage
  | ToolResultMessage
  | ErrorMessage
  | SystemMessage
  | BashInputMessage
  | BashOutputMessage;

export interface ToolConfirmation {
  name: string;
  args: Record<string, unknown>;
  toolCallId: string;
}
