/**
 * Permission System
 *
 * Provides permission checking and management for tool execution.
 * Supports:
 * - Safe mode (require confirmations)
 * - Permission modes (default, acceptEdits, bypassPermissions)
 * - Persistent permissions per project
 * - Bash command prefix matching
 */

import { log } from "../logger.js";
import {
  isSafeModeEnabled,
  getPermissionMode,
  getProjectConfig,
  addAllowedTool,
  isToolAllowed,
} from "./settings.js";
import { needsPermission } from "./tools/types.js";

/**
 * Safe commands that never need permission
 */
const SAFE_COMMANDS = new Set([
  // Git read commands
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git show",
  "git remote",
  "git tag",
  "git stash list",
  // System info commands
  "pwd",
  "whoami",
  "date",
  "which",
  "where",
  "echo",
  "env",
  "printenv",
  // Directory listing
  "ls",
  "dir",
  "tree",
  // Node/npm info
  "node --version",
  "npm --version",
  "bun --version",
  "pnpm --version",
  "yarn --version",
]);

/**
 * Safe command prefixes
 */
const SAFE_COMMAND_PREFIXES = [
  "git status",
  "git diff",
  "git log",
  "git show",
  "git branch",
];

/**
 * Result of permission check
 */
export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Tool use confirmation data
 */
export interface ToolUseConfirm {
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  commandPrefix?: string | null;
}

/**
 * Check if a bash command is safe (doesn't need permission)
 */
export function isSafeBashCommand(command: string): boolean {
  const trimmedCommand = command.trim().toLowerCase();

  // Check exact match
  if (SAFE_COMMANDS.has(trimmedCommand)) {
    return true;
  }

  // Check prefix match
  for (const prefix of SAFE_COMMAND_PREFIXES) {
    if (trimmedCommand.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Get permission key for a tool
 *
 * Examples:
 * - Bash: "Bash(npm:*)" or "Bash(git diff)"
 * - Edit: "Edit" (session-only)
 * - Write: "Write" (session-only)
 */
export function getPermissionKey(
  toolName: string,
  toolArgs: Record<string, unknown>,
  prefix?: string | null
): string {
  if (toolName === "Bash") {
    const command = (toolArgs.command as string) || "";
    if (prefix) {
      return `Bash(${prefix}:*)`;
    }
    return `Bash(${command})`;
  }

  return toolName;
}

/**
 * Extract command prefix from bash command
 *
 * Examples:
 * - "npm install" -> "npm"
 * - "git diff HEAD" -> "git"
 * - "bun run build" -> "bun"
 */
export function getCommandPrefix(command: string): string | null {
  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length === 0) {
    return null;
  }

  const firstPart = parts[0].toLowerCase();

  // Common package managers and tools
  const prefixTools = [
    "npm",
    "yarn",
    "pnpm",
    "bun",
    "npx",
    "git",
    "docker",
    "kubectl",
    "make",
    "cargo",
    "go",
    "pip",
    "python",
    "node",
  ];

  if (prefixTools.includes(firstPart)) {
    return firstPart;
  }

  return null;
}

/**
 * Check if tool has permission to execute
 */
export function hasToolPermission(
  toolName: string,
  toolArgs: Record<string, unknown>
): PermissionResult {
  // 1. If safe mode is disabled, allow all
  if (!isSafeModeEnabled()) {
    return { allowed: true };
  }

  // 2. Check permission mode
  const mode = getPermissionMode();

  if (mode === "bypassPermissions") {
    return { allowed: true };
  }

  if (mode === "acceptEdits" && (toolName === "Edit" || toolName === "Write")) {
    return { allowed: true };
  }

  // 3. Check if tool needs permission at all
  if (!needsPermission(toolName)) {
    return { allowed: true };
  }

  // 4. Special handling for Bash tool
  if (toolName === "Bash") {
    const command = (toolArgs.command as string) || "";

    // Check if it's a safe command
    if (isSafeBashCommand(command)) {
      return { allowed: true };
    }

    // Check exact command permission
    const exactKey = getPermissionKey(toolName, toolArgs);
    if (isToolAllowed(exactKey)) {
      return { allowed: true };
    }

    // Check prefix permission
    const prefix = getCommandPrefix(command);
    if (prefix) {
      const prefixKey = getPermissionKey(toolName, toolArgs, prefix);
      if (isToolAllowed(prefixKey)) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: `Bash command needs permission: ${command}`,
    };
  }

  // 5. Check project config for other tools
  const toolKey = getPermissionKey(toolName, toolArgs);
  if (isToolAllowed(toolKey)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Tool needs permission: ${toolName}`,
  };
}

/**
 * Save permanent permission
 */
export function saveToolPermission(
  toolName: string,
  toolArgs: Record<string, unknown>,
  usePrefix: boolean = false
): void {
  let key: string;

  if (toolName === "Bash" && usePrefix) {
    const command = (toolArgs.command as string) || "";
    const prefix = getCommandPrefix(command);
    key = getPermissionKey(toolName, toolArgs, prefix);
  } else {
    key = getPermissionKey(toolName, toolArgs);
  }

  addAllowedTool(key);
  log.info("Permission saved", { tool: toolName, key });
}

// ==========================================
// Session-based permissions (for Edit/Write)
// ==========================================

// In-memory storage for session-based file permissions
const sessionWritePermissions = new Set<string>();
const sessionEditPermissions = new Set<string>();

/**
 * Grant session write permission for a directory
 */
export function grantSessionWritePermission(directory: string): void {
  sessionWritePermissions.add(directory);
}

/**
 * Grant session edit permission for a directory
 */
export function grantSessionEditPermission(directory: string): void {
  sessionEditPermissions.add(directory);
}

/**
 * Check if path has session write permission
 */
export function hasSessionWritePermission(filePath: string): boolean {
  for (const dir of sessionWritePermissions) {
    if (filePath.startsWith(dir)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if path has session edit permission
 */
export function hasSessionEditPermission(filePath: string): boolean {
  for (const dir of sessionEditPermissions) {
    if (filePath.startsWith(dir)) {
      return true;
    }
  }
  return false;
}

/**
 * Clear all session permissions
 */
export function clearSessionPermissions(): void {
  sessionWritePermissions.clear();
  sessionEditPermissions.clear();
}

/**
 * Get list of allowed tools for current project
 */
export function getAllowedTools(): string[] {
  return getProjectConfig().allowedTools;
}
