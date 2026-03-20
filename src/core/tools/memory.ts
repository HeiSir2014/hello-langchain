/**
 * Memory Tools
 *
 * Agent-facing tools for persistent memory management.
 * Uses the OpenClaw-inspired memory service for two-layer storage:
 * - MemorySave: Save important information to long-term or daily memory
 * - MemorySearch: Search across all memory files
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import {
  writeLongTermMemory,
  appendDailyLog,
  searchMemory,
  getMemoryStats,
  loadBootstrapMemory,
} from "../services/memory.js";

/**
 * MemorySave - Save information to persistent memory
 */
export const MemorySave = tool(
  async ({
    content,
    target,
    scope,
  }: {
    content: string;
    target: "long-term" | "daily";
    scope: "user" | "project";
  }) => {
    if (target === "long-term") {
      const success = writeLongTermMemory(content, scope);
      if (success) {
        return `Saved to long-term memory (MEMORY.md, scope: ${scope})`;
      }
      return "Failed to save to long-term memory";
    } else {
      const success = appendDailyLog(content, scope);
      if (success) {
        return `Saved to today's daily log (scope: ${scope})`;
      }
      return "Failed to save to daily log";
    }
  },
  {
    name: "MemorySave",
    description:
      "Save important information to persistent memory. Use 'long-term' for durable facts, decisions, and preferences (MEMORY.md). Use 'daily' for session context and task progress (daily log).",
    schema: z.object({
      content: z
        .string()
        .describe("The information to save to memory"),
      target: z
        .enum(["long-term", "daily"])
        .default("daily")
        .describe(
          "Where to save: 'long-term' for MEMORY.md (durable facts, decisions), 'daily' for daily log (session context)"
        ),
      scope: z
        .enum(["user", "project"])
        .default("project")
        .describe(
          "Memory scope: 'project' for project-specific, 'user' for cross-project"
        ),
    }),
  }
);

/**
 * MemorySearch - Search across all memory files
 */
export const MemorySearch = tool(
  async ({
    query,
    scope,
    maxResults,
  }: {
    query: string;
    scope: "user" | "project";
    maxResults: number;
  }) => {
    const results = searchMemory(query, scope, maxResults);

    if (results.length === 0) {
      return `No memory matches found for "${query}"`;
    }

    const formatted = results
      .map(
        (r, i) =>
          `[${i + 1}] (${r.source}, relevance: ${(r.relevance * 100).toFixed(0)}%)\n${r.snippet}`
      )
      .join("\n\n");

    return `Found ${results.length} memory matches:\n\n${formatted}`;
  },
  {
    name: "MemorySearch",
    description:
      "Search across all persistent memory files (MEMORY.md and daily logs) for relevant information using keyword matching.",
    schema: z.object({
      query: z.string().describe("Search query (keywords)"),
      scope: z
        .enum(["user", "project"])
        .default("project")
        .describe("Memory scope to search"),
      maxResults: z
        .number()
        .default(10)
        .describe("Maximum number of results to return"),
    }),
  }
);

/**
 * MemoryStats - Get memory usage statistics (used internally, not exposed as agent tool)
 */
export function getMemoryStatsFormatted(scope: "user" | "project" = "project"): string {
  const stats = getMemoryStats(scope);
  const lines = [
    `Memory Stats (${scope}):`,
    `  Long-term memory: ${stats.hasLongTermMemory ? `${stats.longTermSize} bytes` : "none"}`,
    `  Daily logs: ${stats.dailyLogCount} files`,
    `  Total size: ${stats.totalSize} bytes`,
  ];
  return lines.join("\n");
}
