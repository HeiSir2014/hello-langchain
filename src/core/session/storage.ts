/**
 * Session Storage Module
 *
 * Manages session persistence for YTerm:
 * - Session metadata storage
 * - Message serialization/deserialization
 * - Session listing and loading
 *
 * Storage structure:
 * ~/.yterm/sessions/
 *   ├── index.json          # Session index with metadata
 *   └── {sessionId}.json    # Individual session data
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { MessageItem } from "../../ui/types/messages.js";
import type { BaseMessage } from "@langchain/core/messages";
import { log } from "../../logger.js";

// Session storage directory
const SESSIONS_DIR = join(homedir(), ".yterm", "sessions");

// Ensure sessions directory exists
function ensureSessionsDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/**
 * Session metadata stored in index
 */
export interface SessionMetadata {
  sessionId: string;
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // ISO timestamp
  model: string;
  messageCount: number;
  firstPrompt: string;     // Preview of first user message (truncated)
  cwd: string;             // Working directory when session started
  threadId: string;        // LangGraph thread ID for checkpointer
}

/**
 * Full session data stored in individual files
 */
export interface SessionData {
  metadata: SessionMetadata;
  uiMessages: MessageItem[];           // UI messages for display
  langGraphMessages: SerializedLangGraphMessage[];  // LangGraph messages for agent state
}

/**
 * Serialized LangGraph message format
 */
export interface SerializedLangGraphMessage {
  type: "human" | "ai" | "system" | "tool";
  content: string | any[];
  id?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
  additional_kwargs?: Record<string, any>;
}

/**
 * Session index (lightweight list of all sessions)
 */
interface SessionIndex {
  version: number;
  sessions: SessionMetadata[];
}

const CURRENT_VERSION = 1;
const MAX_SESSIONS = 50;  // Keep only the last 50 sessions

/**
 * Load session index
 */
function loadSessionIndex(): SessionIndex {
  ensureSessionsDir();
  const indexPath = join(SESSIONS_DIR, "index.json");

  if (!existsSync(indexPath)) {
    return { version: CURRENT_VERSION, sessions: [] };
  }

  try {
    const content = readFileSync(indexPath, "utf-8");
    return JSON.parse(content) as SessionIndex;
  } catch (error: any) {
    log.warn("Failed to load session index", { error: error.message });
    return { version: CURRENT_VERSION, sessions: [] };
  }
}

/**
 * Save session index
 */
function saveSessionIndex(index: SessionIndex): void {
  ensureSessionsDir();
  const indexPath = join(SESSIONS_DIR, "index.json");

  try {
    writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
  } catch (error: any) {
    log.error("Failed to save session index", { error: error.message });
  }
}

/**
 * Get session file path
 */
function getSessionFilePath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.json`);
}

/**
 * Serialize LangGraph messages for storage
 */
export function serializeLangGraphMessages(messages: BaseMessage[]): SerializedLangGraphMessage[] {
  return messages.map((msg) => {
    const serialized: SerializedLangGraphMessage = {
      type: getMessageType(msg),
      content: msg.content,
      id: msg.id,
    };

    // Preserve tool calls for AI messages
    if ("tool_calls" in msg && (msg as any).tool_calls) {
      serialized.tool_calls = (msg as any).tool_calls;
    }

    // Preserve tool call ID for tool messages
    if ("tool_call_id" in msg) {
      serialized.tool_call_id = (msg as any).tool_call_id;
    }

    // Preserve name for tool messages
    if ("name" in msg && (msg as any).name) {
      serialized.name = (msg as any).name;
    }

    // Preserve additional kwargs
    if (msg.additional_kwargs && Object.keys(msg.additional_kwargs).length > 0) {
      serialized.additional_kwargs = msg.additional_kwargs;
    }

    return serialized;
  });
}

/**
 * Get message type string from BaseMessage
 */
function getMessageType(msg: BaseMessage): "human" | "ai" | "system" | "tool" {
  const type = msg._getType();
  switch (type) {
    case "human":
      return "human";
    case "ai":
      return "ai";
    case "system":
      return "system";
    case "tool":
      return "tool";
    default:
      return "ai";
  }
}

/**
 * Save a session
 */
export function saveSession(
  sessionId: string,
  threadId: string,
  model: string,
  uiMessages: MessageItem[],
  langGraphMessages: BaseMessage[],
  cwd: string = process.cwd()
): void {
  ensureSessionsDir();

  // Get first user prompt for preview
  const firstUserMsg = uiMessages.find((m) => m.type === "user");
  const firstPrompt = firstUserMsg && "content" in firstUserMsg
    ? (firstUserMsg.content as string).slice(0, 100)
    : "";

  const now = new Date().toISOString();

  // Create metadata
  const metadata: SessionMetadata = {
    sessionId,
    createdAt: now,
    updatedAt: now,
    model,
    messageCount: uiMessages.length,
    firstPrompt,
    cwd,
    threadId,
  };

  // Create session data
  const sessionData: SessionData = {
    metadata,
    uiMessages,
    langGraphMessages: serializeLangGraphMessages(langGraphMessages),
  };

  // Save session file
  const sessionPath = getSessionFilePath(sessionId);
  try {
    writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), "utf-8");
    log.info("Session saved", { sessionId, messageCount: uiMessages.length });
  } catch (error: any) {
    log.error("Failed to save session", { sessionId, error: error.message });
    return;
  }

  // Update index
  const index = loadSessionIndex();

  // Remove existing entry for this session (if updating)
  index.sessions = index.sessions.filter((s) => s.sessionId !== sessionId);

  // Add new/updated entry at the beginning
  index.sessions.unshift(metadata);

  // Trim old sessions
  if (index.sessions.length > MAX_SESSIONS) {
    const removedSessions = index.sessions.splice(MAX_SESSIONS);
    // Delete old session files
    for (const session of removedSessions) {
      const oldPath = getSessionFilePath(session.sessionId);
      if (existsSync(oldPath)) {
        try {
          unlinkSync(oldPath);
        } catch {
          // Ignore deletion errors
        }
      }
    }
  }

  saveSessionIndex(index);
}

/**
 * Update an existing session (for incremental saves)
 */
export function updateSession(
  sessionId: string,
  uiMessages: MessageItem[],
  langGraphMessages: BaseMessage[]
): void {
  const sessionPath = getSessionFilePath(sessionId);

  if (!existsSync(sessionPath)) {
    log.warn("Session not found for update", { sessionId });
    return;
  }

  try {
    // Load existing session
    const content = readFileSync(sessionPath, "utf-8");
    const sessionData = JSON.parse(content) as SessionData;

    // Update data
    sessionData.uiMessages = uiMessages;
    sessionData.langGraphMessages = serializeLangGraphMessages(langGraphMessages);
    sessionData.metadata.updatedAt = new Date().toISOString();
    sessionData.metadata.messageCount = uiMessages.length;

    // Update first prompt if not set
    if (!sessionData.metadata.firstPrompt) {
      const firstUserMsg = uiMessages.find((m) => m.type === "user");
      if (firstUserMsg && "content" in firstUserMsg) {
        sessionData.metadata.firstPrompt = (firstUserMsg.content as string).slice(0, 100);
      }
    }

    // Save updated session
    writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), "utf-8");

    // Update index
    const index = loadSessionIndex();
    const indexEntry = index.sessions.find((s) => s.sessionId === sessionId);
    if (indexEntry) {
      indexEntry.updatedAt = sessionData.metadata.updatedAt;
      indexEntry.messageCount = sessionData.metadata.messageCount;
      if (!indexEntry.firstPrompt) {
        indexEntry.firstPrompt = sessionData.metadata.firstPrompt;
      }
      saveSessionIndex(index);
    }

    log.debug("Session updated", { sessionId, messageCount: uiMessages.length });
  } catch (error: any) {
    log.error("Failed to update session", { sessionId, error: error.message });
  }
}

/**
 * Load a session by ID
 */
export function loadSession(sessionId: string): SessionData | null {
  const sessionPath = getSessionFilePath(sessionId);

  if (!existsSync(sessionPath)) {
    log.warn("Session file not found", { sessionId });
    return null;
  }

  try {
    const content = readFileSync(sessionPath, "utf-8");
    const sessionData = JSON.parse(content) as SessionData;
    log.info("Session loaded", { sessionId, messageCount: sessionData.uiMessages.length });
    return sessionData;
  } catch (error: any) {
    log.error("Failed to load session", { sessionId, error: error.message });
    return null;
  }
}

/**
 * List all sessions (sorted by updatedAt, newest first)
 */
export function listSessions(): SessionMetadata[] {
  const index = loadSessionIndex();
  return index.sessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Get the most recent session
 */
export function getLatestSession(): SessionMetadata | null {
  const sessions = listSessions();
  return sessions.length > 0 ? sessions[0] : null;
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): boolean {
  const sessionPath = getSessionFilePath(sessionId);

  // Remove from index
  const index = loadSessionIndex();
  index.sessions = index.sessions.filter((s) => s.sessionId !== sessionId);
  saveSessionIndex(index);

  // Delete file
  if (existsSync(sessionPath)) {
    try {
      unlinkSync(sessionPath);
      log.info("Session deleted", { sessionId });
      return true;
    } catch (error: any) {
      log.error("Failed to delete session file", { sessionId, error: error.message });
      return false;
    }
  }

  return true;
}

/**
 * Clean up orphaned session files
 */
export function cleanupOrphanedSessions(): void {
  ensureSessionsDir();

  const index = loadSessionIndex();
  const validIds = new Set(index.sessions.map((s) => s.sessionId));

  try {
    const files = readdirSync(SESSIONS_DIR);
    for (const file of files) {
      if (file === "index.json") continue;
      if (!file.endsWith(".json")) continue;

      const sessionId = file.replace(".json", "");
      if (!validIds.has(sessionId)) {
        const filePath = join(SESSIONS_DIR, file);
        try {
          unlinkSync(filePath);
          log.debug("Removed orphaned session file", { sessionId });
        } catch {
          // Ignore
        }
      }
    }
  } catch (error: any) {
    log.warn("Failed to cleanup orphaned sessions", { error: error.message });
  }
}

// Export storage directory path
export { SESSIONS_DIR };
