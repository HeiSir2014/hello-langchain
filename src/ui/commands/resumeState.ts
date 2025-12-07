/**
 * Resume State
 *
 * Shared state for session resume functionality.
 * This is used to pass resume data from the /resume command to the REPL.
 */
import type { MessageItem } from "../types/messages.js";
import type { BaseMessage } from "@langchain/core/messages";

/**
 * Data needed to resume a session
 */
export interface ResumeData {
  sessionId: string;
  threadId: string;
  model: string;
  uiMessages: MessageItem[];
  langGraphMessages: BaseMessage[];
}

// Singleton resume data
let pendingResumeData: ResumeData | null = null;

/**
 * Set resume data (called by /resume command)
 */
export function setResumeData(data: ResumeData): void {
  pendingResumeData = data;
}

/**
 * Get and clear resume data (called by REPL)
 */
export function consumeResumeData(): ResumeData | null {
  const data = pendingResumeData;
  pendingResumeData = null;
  return data;
}

/**
 * Check if there's pending resume data
 */
export function hasPendingResumeData(): boolean {
  return pendingResumeData !== null;
}
