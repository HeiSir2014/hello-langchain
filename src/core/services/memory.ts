/**
 * Memory Service
 *
 * OpenClaw-inspired persistent memory system using plain Markdown files.
 * Two-layer memory architecture:
 * 1. MEMORY.md - Long-term durable facts, decisions, user preferences
 * 2. memory/YYYY-MM-DD.md - Daily logs with session context
 *
 * Files are the source of truth; the agent "remembers" what gets written to disk.
 * Memory is loaded at session start and searchable via keyword matching.
 *
 * Storage: ~/.yterm/memory/ (user-level) or .yterm/memory/ (project-level)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { log } from "../../logger.js";

// ============ Paths ============

const USER_MEMORY_DIR = join(homedir(), ".yterm", "memory");
const PROJECT_MEMORY_DIR = join(process.cwd(), ".yterm", "memory");

/**
 * Get the memory directory for the specified scope
 */
function getMemoryDir(scope: "user" | "project"): string {
  return scope === "user" ? USER_MEMORY_DIR : PROJECT_MEMORY_DIR;
}

/**
 * Ensure memory directory exists
 */
function ensureMemoryDir(scope: "user" | "project"): void {
  const dir = getMemoryDir(scope);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============ MEMORY.md (Long-term) ============

/**
 * Get MEMORY.md file path
 */
function getMemoryFilePath(scope: "user" | "project"): string {
  const dir = scope === "user" ? join(homedir(), ".yterm") : join(process.cwd(), ".yterm");
  return join(dir, "MEMORY.md");
}

/**
 * Read long-term memory (MEMORY.md)
 */
export function readLongTermMemory(scope: "user" | "project" = "project"): string {
  const filePath = getMemoryFilePath(scope);

  if (!existsSync(filePath)) {
    return "";
  }

  try {
    return readFileSync(filePath, "utf-8");
  } catch (error: any) {
    log.warn("Failed to read MEMORY.md", { scope, error: error.message });
    return "";
  }
}

/**
 * Write to long-term memory (MEMORY.md)
 * Appends new content or replaces entire file
 */
export function writeLongTermMemory(
  content: string,
  scope: "user" | "project" = "project",
  mode: "append" | "replace" = "append"
): boolean {
  const filePath = getMemoryFilePath(scope);
  const dir = scope === "user" ? join(homedir(), ".yterm") : join(process.cwd(), ".yterm");

  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (mode === "append") {
      const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
      const timestamp = new Date().toISOString().split("T")[0];
      const newContent = existing
        ? `${existing}\n\n## ${timestamp}\n\n${content}`
        : `# Memory\n\n## ${timestamp}\n\n${content}`;
      writeFileSync(filePath, newContent, "utf-8");
    } else {
      writeFileSync(filePath, content, "utf-8");
    }

    log.info("Long-term memory updated", { scope, mode, contentLength: content.length });
    return true;
  } catch (error: any) {
    log.error("Failed to write MEMORY.md", { scope, error: error.message });
    return false;
  }
}

// ============ Daily Logs ============

/**
 * Get today's date string (YYYY-MM-DD)
 */
function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Get yesterday's date string
 */
function getYesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

/**
 * Get daily log file path
 */
function getDailyLogPath(date: string, scope: "user" | "project"): string {
  return join(getMemoryDir(scope), `${date}.md`);
}

/**
 * Read a daily log
 */
export function readDailyLog(date: string, scope: "user" | "project" = "project"): string {
  const filePath = getDailyLogPath(date, scope);

  if (!existsSync(filePath)) {
    return "";
  }

  try {
    return readFileSync(filePath, "utf-8");
  } catch (error: any) {
    log.warn("Failed to read daily log", { date, scope, error: error.message });
    return "";
  }
}

/**
 * Append to today's daily log
 */
export function appendDailyLog(
  content: string,
  scope: "user" | "project" = "project"
): boolean {
  ensureMemoryDir(scope);
  const today = getTodayStr();
  const filePath = getDailyLogPath(today, scope);

  try {
    const timestamp = new Date().toTimeString().split(" ")[0];
    const entry = `\n### ${timestamp}\n\n${content}\n`;

    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, "utf-8");
      writeFileSync(filePath, existing + entry, "utf-8");
    } else {
      const header = `# Daily Log - ${today}\n${entry}`;
      writeFileSync(filePath, header, "utf-8");
    }

    log.debug("Daily log appended", { date: today, scope, contentLength: content.length });
    return true;
  } catch (error: any) {
    log.error("Failed to append daily log", { scope, error: error.message });
    return false;
  }
}

// ============ Memory Loading ============

/**
 * Load bootstrap memory for session start.
 * Returns MEMORY.md + today's log + yesterday's log.
 * Follows OpenClaw pattern: load recent context without overwhelming context window.
 */
export function loadBootstrapMemory(scope: "user" | "project" = "project"): string {
  const parts: string[] = [];

  // 1. Long-term memory
  const longTerm = readLongTermMemory(scope);
  if (longTerm) {
    parts.push(`## Long-term Memory\n\n${longTerm}`);
  }

  // 2. Today's daily log
  const today = getTodayStr();
  const todayLog = readDailyLog(today, scope);
  if (todayLog) {
    parts.push(`## Today's Log (${today})\n\n${todayLog}`);
  }

  // 3. Yesterday's daily log
  const yesterday = getYesterdayStr();
  const yesterdayLog = readDailyLog(yesterday, scope);
  if (yesterdayLog) {
    parts.push(`## Yesterday's Log (${yesterday})\n\n${yesterdayLog}`);
  }

  if (parts.length === 0) {
    return "";
  }

  return `# Agent Memory\n\n${parts.join("\n\n---\n\n")}`;
}

// ============ Memory Search ============

/**
 * Search across all memory files for matching content.
 * Uses simple keyword matching (can be enhanced with embeddings later).
 *
 * @param query Search query
 * @param scope Memory scope
 * @param maxResults Maximum results to return
 */
export function searchMemory(
  query: string,
  scope: "user" | "project" = "project",
  maxResults: number = 10
): MemorySearchResult[] {
  const results: MemorySearchResult[] = [];
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  // Search MEMORY.md
  const longTerm = readLongTermMemory(scope);
  if (longTerm) {
    const matches = searchInContent(longTerm, queryWords, "MEMORY.md");
    results.push(...matches);
  }

  // Search daily logs
  const memoryDir = getMemoryDir(scope);
  if (existsSync(memoryDir)) {
    try {
      const files = readdirSync(memoryDir)
        .filter(f => f.endsWith(".md"))
        .sort()
        .reverse() // newest first
        .slice(0, 30); // last 30 days

      for (const file of files) {
        const filePath = join(memoryDir, file);
        const content = readFileSync(filePath, "utf-8");
        const matches = searchInContent(content, queryWords, `memory/${file}`);
        results.push(...matches);
      }
    } catch (error: any) {
      log.warn("Failed to search daily logs", { error: error.message });
    }
  }

  // Sort by relevance (number of matching words) and limit
  results.sort((a, b) => b.relevance - a.relevance);
  return results.slice(0, maxResults);
}

/**
 * Memory search result
 */
export interface MemorySearchResult {
  /** Source file */
  source: string;
  /** Matched content snippet */
  snippet: string;
  /** Relevance score (number of matching words) */
  relevance: number;
}

/**
 * Search within content and return matching sections
 */
function searchInContent(
  content: string,
  queryWords: string[],
  source: string
): MemorySearchResult[] {
  const results: MemorySearchResult[] = [];

  // Split into sections by headers or double newlines
  const sections = content.split(/\n(?=#{1,3}\s)|\n\n/).filter(s => s.trim());

  for (const section of sections) {
    const sectionLower = section.toLowerCase();
    const matchCount = queryWords.filter(w => sectionLower.includes(w)).length;

    if (matchCount > 0) {
      results.push({
        source,
        snippet: section.trim().slice(0, 500),
        relevance: matchCount / queryWords.length,
      });
    }
  }

  return results;
}

// ============ Memory Flush ============

/**
 * Build a memory flush prompt.
 * Used before context compaction to remind the agent to save important context.
 * Follows OpenClaw's pattern of silent agentic turns.
 */
export function buildMemoryFlushPrompt(): string {
  return `<system-reminder>
IMPORTANT: Context compaction is about to occur. Before your conversation history is compressed, please save any important information that should persist:

1. Use the MemorySave tool to save key decisions, user preferences, or important facts to long-term memory (MEMORY.md)
2. Save any ongoing task context to today's daily log

Information NOT saved to memory files will be lost during compaction.
Only save truly important information - not everything from the conversation.

Focus on:
- User preferences and coding style decisions
- Key technical decisions and their rationale
- Important findings from research
- Current task status and next steps
</system-reminder>`;
}

/**
 * Get memory statistics
 */
export function getMemoryStats(scope: "user" | "project" = "project"): {
  hasLongTermMemory: boolean;
  longTermSize: number;
  dailyLogCount: number;
  totalSize: number;
} {
  let longTermSize = 0;
  let dailyLogCount = 0;
  let totalSize = 0;

  // Check MEMORY.md
  const memoryPath = getMemoryFilePath(scope);
  const hasLongTermMemory = existsSync(memoryPath);
  if (hasLongTermMemory) {
    try {
      longTermSize = readFileSync(memoryPath, "utf-8").length;
      totalSize += longTermSize;
    } catch {}
  }

  // Count daily logs
  const memoryDir = getMemoryDir(scope);
  if (existsSync(memoryDir)) {
    try {
      const files = readdirSync(memoryDir).filter(f => f.endsWith(".md"));
      dailyLogCount = files.length;
      for (const file of files) {
        try {
          totalSize += readFileSync(join(memoryDir, file), "utf-8").length;
        } catch {}
      }
    } catch {}
  }

  return { hasLongTermMemory, longTermSize, dailyLogCount, totalSize };
}
