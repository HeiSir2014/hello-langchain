/**
 * Session Deserializer
 *
 * Reconstructs LangGraph messages and UI messages from stored session data.
 */
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { SerializedLangGraphMessage, SessionData } from "./storage.js";
import type { MessageItem } from "../../ui/types/messages.js";
import { log } from "../../logger.js";

/**
 * Deserialize LangGraph messages from storage format
 */
export function deserializeLangGraphMessages(
  serialized: SerializedLangGraphMessage[]
): BaseMessage[] {
  return serialized.map((msg) => {
    switch (msg.type) {
      case "human":
        return new HumanMessage({
          content: msg.content,
          id: msg.id,
          additional_kwargs: msg.additional_kwargs,
        });

      case "ai":
        const aiMsg = new AIMessage({
          content: msg.content,
          id: msg.id,
          tool_calls: msg.tool_calls,
          additional_kwargs: msg.additional_kwargs,
        });
        return aiMsg;

      case "system":
        return new SystemMessage({
          content: msg.content,
          id: msg.id,
          additional_kwargs: msg.additional_kwargs,
        });

      case "tool":
        return new ToolMessage({
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          tool_call_id: msg.tool_call_id || "",
          name: msg.name,
          id: msg.id,
          additional_kwargs: msg.additional_kwargs,
        });

      default:
        log.warn("Unknown message type during deserialization", { type: msg.type });
        return new HumanMessage({
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          id: msg.id,
        });
    }
  });
}

/**
 * Restore a session for continuation
 * Returns both UI messages and LangGraph messages
 */
export function restoreSession(sessionData: SessionData): {
  uiMessages: MessageItem[];
  langGraphMessages: BaseMessage[];
  metadata: SessionData["metadata"];
} {
  const langGraphMessages = deserializeLangGraphMessages(sessionData.langGraphMessages);

  log.info("Session restored", {
    sessionId: sessionData.metadata.sessionId,
    uiMessageCount: sessionData.uiMessages.length,
    langGraphMessageCount: langGraphMessages.length,
  });

  return {
    uiMessages: sessionData.uiMessages,
    langGraphMessages,
    metadata: sessionData.metadata,
  };
}

/**
 * Validate session data integrity
 */
export function validateSessionData(data: unknown): data is SessionData {
  if (!data || typeof data !== "object") return false;

  const session = data as any;

  // Check required fields
  if (!session.metadata || typeof session.metadata !== "object") return false;
  if (!session.uiMessages || !Array.isArray(session.uiMessages)) return false;
  if (!session.langGraphMessages || !Array.isArray(session.langGraphMessages)) return false;

  // Check metadata fields
  const { metadata } = session;
  if (typeof metadata.sessionId !== "string") return false;
  if (typeof metadata.threadId !== "string") return false;

  return true;
}
