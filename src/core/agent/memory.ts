/**
 * Memory Management Module
 *
 * Token counting, context compression, and conversation summarization.
 * Uses shared utilities from core/utils/messages.ts.
 */

import { BaseMessage, AIMessage } from "@langchain/core/messages";
import { getModelContextWindow } from "../config.js";
import { messagesToText } from "../utils/messages.js";

// Auto-compact threshold (triggers compression when reached)
const AUTO_COMPACT_THRESHOLD = 0.92; // 92%

// Per-message overhead for role/formatting tokens
const MESSAGE_OVERHEAD_TOKENS = 4;

// Per-tool-call overhead for formatting
const TOOL_CALL_OVERHEAD_TOKENS = 10;

// ============ Token Counting ============

/**
 * Estimate token count for a text string.
 * Chinese: ~1.5 chars/token, English/other: ~4 chars/token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;

  return Math.ceil(chineseChars / 1.5) + Math.ceil(otherChars / 4);
}

/**
 * Count total estimated tokens for a message array.
 */
export function countMessageTokens(messages: BaseMessage[]): number {
  let totalTokens = 0;

  for (const msg of messages) {
    const content = typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content);
    const contentTokens = estimateTokens(content);

    let toolTokens = 0;
    if (msg instanceof AIMessage && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        toolTokens += estimateTokens(tc.name);
        toolTokens += estimateTokens(JSON.stringify(tc.args));
        toolTokens += TOOL_CALL_OVERHEAD_TOKENS;
      }
    }

    totalTokens += MESSAGE_OVERHEAD_TOKENS + contentTokens + toolTokens;
  }

  return totalTokens;
}

// ============ Compression Prompt ============

/**
 * Structured summary prompt template.
 * Single source of truth for compression format - used by both
 * auto-compact (summarizeNode) and manual compact (/compact command).
 */
export const COMPRESSION_PROMPT = `Please provide a comprehensive summary of our conversation structured as follows:

## Technical Context
Development environment, tools, frameworks, and configurations in use. Programming languages, libraries, and technical constraints. File structure, directory organization, and project architecture.

## Project Overview
Main project goals, features, and scope. Key components, modules, and their relationships. Data models, APIs, and integration patterns.

## Code Changes
Files created, modified, or analyzed during our conversation. Specific code implementations, functions, and algorithms added. Configuration changes and structural modifications.

## Debugging & Issues
Problems encountered and their root causes. Solutions implemented and their effectiveness. Error messages, logs, and diagnostic information.

## Current Status
What we just completed successfully. Current state of the codebase and any ongoing work. Test results, validation steps, and verification performed.

## Pending Tasks
Immediate next steps and priorities. Planned features, improvements, and refactoring. Known issues, technical debt, and areas needing attention.

## User Preferences
Coding style, formatting, and organizational preferences. Communication patterns and feedback style. Tool choices and workflow preferences.

## Key Decisions
Important technical decisions made and their rationale. Alternative approaches considered and why they were rejected. Trade-offs accepted and their implications.

Focus on information essential for continuing the conversation effectively, including specific details about code, files, errors, and plans.`;

/**
 * Build a complete summary prompt with conversation content.
 */
export function buildComprehensiveSummaryPrompt(messages: BaseMessage[]): string {
  const conversationText = messagesToText(messages);
  return `${COMPRESSION_PROMPT}\n\nConversation:\n${conversationText}`;
}

// ============ Context Usage ============

export interface ContextUsage {
  tokenCount: number;
  contextLimit: number;
  percentUsed: number;
  isAboveAutoCompactThreshold: boolean;
  tokensRemaining: number;
}

/**
 * Calculate context window usage for the given messages and model.
 */
export function getContextUsage(messages: BaseMessage[], modelName: string): ContextUsage {
  const contextLimit = getModelContextWindow(modelName);
  const tokenCount = countMessageTokens(messages);
  const autoCompactThreshold = contextLimit * AUTO_COMPACT_THRESHOLD;

  return {
    tokenCount,
    contextLimit,
    percentUsed: Math.round((tokenCount / contextLimit) * 100),
    isAboveAutoCompactThreshold: tokenCount >= autoCompactThreshold,
    tokensRemaining: Math.max(0, autoCompactThreshold - tokenCount),
  };
}

export const MEMORY_CONSTANTS = {
  AUTO_COMPACT_THRESHOLD,
  MESSAGE_OVERHEAD_TOKENS,
  TOOL_CALL_OVERHEAD_TOKENS,
};
