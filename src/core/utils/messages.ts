/**
 * Message Utilities
 *
 * Shared utility functions for working with LangChain messages.
 * Used by agent/index.ts, agent/supervisor.ts, and other modules.
 */

import { BaseMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";

/**
 * Extract text from message content (handles string and array formats).
 * Many LLM providers return content as either a string or an array of
 * content blocks (text, image, etc.).
 */
export function extractTextContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return part.text;
        return "";
      })
      .join("");
  }
  return String(content);
}

/**
 * Convert messages to readable text format (for LLM summarization).
 * Tool results are truncated to avoid excessive token usage.
 */
export function messagesToText(messages: BaseMessage[], maxToolResultLength = 500): string {
  const lines: string[] = [];

  for (const msg of messages) {
    if (msg instanceof HumanMessage) {
      const content = typeof msg.content === "string" ? msg.content : extractTextContent(msg.content);
      lines.push(`User: ${content}`);
    } else if (msg instanceof AIMessage) {
      if (msg.tool_calls?.length) {
        const toolNames = msg.tool_calls.map(tc => tc.name).join(", ");
        lines.push(`Assistant: [Tool calls: ${toolNames}]`);
      } else {
        const content = typeof msg.content === "string" ? msg.content : extractTextContent(msg.content);
        lines.push(`Assistant: ${content}`);
      }
    } else if (msg instanceof ToolMessage) {
      const content = typeof msg.content === "string" ? msg.content : extractTextContent(msg.content);
      const preview = content.length > maxToolResultLength
        ? content.slice(0, maxToolResultLength) + "..."
        : content;
      lines.push(`Tool[${msg.name}] result: ${preview}`);
    }
  }

  return lines.join("\n\n");
}

/**
 * Get the text content of a message as a string.
 */
export function getMessageText(msg: BaseMessage): string {
  return typeof msg.content === "string" ? msg.content : extractTextContent(msg.content);
}
