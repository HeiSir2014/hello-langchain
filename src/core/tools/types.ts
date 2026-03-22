/**
 * Enhanced Tool Types
 *
 * Provides metadata for tools to enable:
 * - Smart concurrency (read-only tools run in parallel)
 * - Permission checks (sensitive tools need confirmation)
 * - Progress reporting for real-time UI updates
 */

import type { StructuredToolInterface } from "@langchain/core/tools";

// Re-export for potential future use
export type { StructuredToolInterface };

/**
 * Tool metadata for enhanced execution control
 */
export interface ToolMetadata {
  /** Human-readable description for help/UI */
  description: string;
  /** Tool is read-only and safe to run concurrently */
  isReadOnly: boolean;
  /** Tool is safe to run concurrently with other tools */
  isConcurrencySafe: boolean;
  /** Tool requires user permission before execution */
  needsPermission: boolean;
  /** Tool category for grouping */
  category: "file" | "bash" | "search" | "task" | "plan" | "memory" | "other";
  /** Only available in plan mode */
  planModeOnly?: boolean;
}

/**
 * Map of tool names to their metadata
 */
export const TOOL_METADATA: Record<string, ToolMetadata> = {
  // File tools
  Read: {
    description: "Read file contents (with line numbers)",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "file",
  },
  Write: {
    description: "Write content to file",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    category: "file",
  },
  Edit: {
    description: "Edit file (string replacement)",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    category: "file",
  },
  LS: {
    description: "List directory contents",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "file",
  },

  // Search tools
  Glob: {
    description: "File pattern matching search (e.g. **/*.ts)",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "search",
  },
  Grep: {
    description: "Search text in file contents (ripgrep)",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "search",
  },
  WebSearch: {
    description: "Search the web using DuckDuckGo",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "search",
  },
  WebFetch: {
    description: "Fetch and analyze content from a URL",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "search",
  },
  MemorySearch: {
    description: "Search across all persistent memory files",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "memory",
  },

  // Bash tools
  Bash: {
    description: "Execute shell commands (supports background execution)",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    category: "bash",
  },
  BashOutput: {
    description: "Get output from background shell",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "bash",
  },
  KillShell: {
    description: "Kill a running background shell",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: false,
    category: "bash",
  },

  // Task management
  TodoWrite: {
    description: "Manage task list for tracking progress",
    isReadOnly: false,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "task",
  },

  // Memory tools
  MemorySave: {
    description: "Save important information to persistent memory (MEMORY.md or daily log)",
    isReadOnly: false,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "memory",
  },

  // Other tools
  Location: {
    description: "Get current location based on IP address",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "other",
  },
  Weather: {
    description: "Get weather information for a location in China",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "other",
  },

  // Plan mode tools
  ExitPlanMode: {
    description: "Exit plan mode and return to normal mode (plan mode only)",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: false,
    category: "plan",
    planModeOnly: true,
  },
  SavePlan: {
    description: "Save implementation plan to a markdown file",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: false,
    category: "plan",
  },
  ReadPlan: {
    description: "Read an existing plan file",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "plan",
  },
};

/**
 * Get metadata for a tool by name.
 * Returns restrictive defaults for unknown tools.
 */
export function getToolMetadata(toolName: string): ToolMetadata {
  return (
    TOOL_METADATA[toolName] || {
      description: toolName,
      isReadOnly: false,
      isConcurrencySafe: false,
      needsPermission: true,
      category: "other",
    }
  );
}

/**
 * Get tool descriptions for help/UI display.
 * Derived from TOOL_METADATA - single source of truth.
 */
export function getToolDescriptions(): Array<{ name: string; description: string; readOnly: boolean; planModeOnly?: boolean }> {
  return Object.entries(TOOL_METADATA).map(([name, meta]) => ({
    name,
    description: meta.description,
    readOnly: meta.isReadOnly,
    ...(meta.planModeOnly && { planModeOnly: true }),
  }));
}

/**
 * Check if a tool is read-only
 */
export function isReadOnlyTool(toolName: string): boolean {
  return getToolMetadata(toolName).isReadOnly;
}

/**
 * Check if a tool is concurrency-safe
 */
export function isConcurrencySafeTool(toolName: string): boolean {
  return getToolMetadata(toolName).isConcurrencySafe;
}

/**
 * Check if a tool needs permission
 */
export function needsPermission(toolName: string): boolean {
  return getToolMetadata(toolName).needsPermission;
}

/**
 * Check if all tools in a list are read-only (can run concurrently)
 */
export function canRunToolsConcurrently(toolNames: string[]): boolean {
  return toolNames.every((name) => isReadOnlyTool(name));
}

/**
 * Sensitive tools that require confirmation
 */
export const SENSITIVE_TOOLS = ["Bash", "Write", "Edit"];

/**
 * Maximum concurrent tool executions
 */
export const MAX_TOOL_CONCURRENCY = 10;
