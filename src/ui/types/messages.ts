// Re-export all message types from core layer
// UI layer imports from here for convenience, but the canonical source is in core
export {
  type MessageType,
  generateMessageId,
  type UserMessage,
  type AssistantMessage,
  type ToolUseMessage,
  type ToolResultMessage,
  type ErrorMessage,
  type SystemMessage,
  type BashInputMessage,
  type BashOutputMessage,
  type MessageItem,
  type ToolConfirmation,
} from '../../core/types/messages.js';
