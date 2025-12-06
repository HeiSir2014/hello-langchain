/**
 * Enhanced Tool Types
 *
 * Provides metadata for tools to enable:
 * - Smart concurrency (read-only tools run in parallel)
 * - Permission checks (sensitive tools need confirmation)
 * - Progress reporting for real-time UI updates
 */

import { StructuredToolInterface } from "@langchain/core/tools";

/**
 * Tool metadata for enhanced execution control
 */
export interface ToolMetadata {
  /** Tool is read-only and safe to run concurrently */
  isReadOnly: boolean;
  /** Tool is safe to run concurrently with other tools */
  isConcurrencySafe: boolean;
  /** Tool requires user permission before execution */
  needsPermission: boolean;
  /** Tool category for grouping */
  category: "file" | "bash" | "search" | "task" | "other";
}

/**
 * Map of tool names to their metadata
 */
export const TOOL_METADATA: Record<string, ToolMetadata> = {
  // Read-only tools - safe to run concurrently
  Read: {
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "file",
  },
  Glob: {
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "search",
  },
  Grep: {
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "search",
  },
  LS: {
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "file",
  },
  BashOutput: {
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "bash",
  },

  // Write tools - need permission, not concurrent safe
  Write: {
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    category: "file",
  },
  Edit: {
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    category: "file",
  },

  // Bash tools - need permission, not concurrent safe
  Bash: {
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    category: "bash",
  },
  KillShell: {
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: false,
    category: "bash",
  },

  // Task management - no permission needed, concurrent safe
  TodoWrite: {
    isReadOnly: false,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "task",
  },

  // Web tools - read-only, concurrent safe, no permission needed
  WebSearch: {
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "search",
  },
  WebFetch: {
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "search",
  },
  Location: {
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    category: "other",
  },
};

/**
 * Get metadata for a tool by name
 */
export function getToolMetadata(toolName: string): ToolMetadata {
  return (
    TOOL_METADATA[toolName] || {
      isReadOnly: false,
      isConcurrencySafe: false,
      needsPermission: true,
      category: "other",
    }
  );
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
