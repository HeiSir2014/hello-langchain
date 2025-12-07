/**
 * Project Directory Detection
 *
 * Provides utilities for detecting and managing project-level configuration directories.
 * Supports both .yterm and .claude directories for compatibility with Claude Code.
 *
 * Priority order (higher overrides lower):
 * 1. .claude/ (Claude Code compatible)
 * 2. .yterm/ (YTerm native)
 *
 * Directory structure:
 * .claude/ or .yterm/
 * ├── skills/           # Custom skill definitions (*.md)
 * ├── commands/         # Custom slash commands (*.md)
 * ├── settings.json     # Project-specific settings (optional)
 * └── CLAUDE.md         # Project instructions (read by context injection)
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { log } from "../logger.js";

// ============ Constants ============

/** Supported project directory names in priority order */
export const PROJECT_DIR_NAMES = [".claude", ".yterm"] as const;

/** User config directory names in priority order */
export const USER_DIR_NAMES = [".claude", ".yterm"] as const;

// ============ Directory Detection ============

/**
 * Find the active project config directory
 * Returns the first existing directory from the priority list
 */
export function getProjectConfigDirName(projectPath?: string): string | null {
  const cwd = projectPath || process.cwd();

  for (const dirName of PROJECT_DIR_NAMES) {
    const dirPath = join(cwd, dirName);
    if (existsSync(dirPath)) {
      return dirName;
    }
  }

  return null;
}

/**
 * Get the project config directory path
 * Returns null if no config directory exists
 */
export function getProjectConfigDirPath(projectPath?: string): string | null {
  const cwd = projectPath || process.cwd();
  const dirName = getProjectConfigDirName(cwd);

  if (dirName) {
    return join(cwd, dirName);
  }

  return null;
}

/**
 * Get all project config directories that exist (for merging configs)
 */
export function getAllProjectConfigDirs(projectPath?: string): string[] {
  const cwd = projectPath || process.cwd();
  const dirs: string[] = [];

  for (const dirName of PROJECT_DIR_NAMES) {
    const dirPath = join(cwd, dirName);
    if (existsSync(dirPath)) {
      dirs.push(dirPath);
    }
  }

  return dirs;
}

/**
 * Find the active user config directory
 */
export function getUserConfigDirName(): string | null {
  const home = homedir();

  for (const dirName of USER_DIR_NAMES) {
    const dirPath = join(home, dirName);
    if (existsSync(dirPath)) {
      return dirName;
    }
  }

  return null;
}

/**
 * Get the user config directory path
 */
export function getUserConfigDirPath(): string | null {
  const home = homedir();
  const dirName = getUserConfigDirName();

  if (dirName) {
    return join(home, dirName);
  }

  return null;
}

/**
 * Get all user config directories that exist
 */
export function getAllUserConfigDirs(): string[] {
  const home = homedir();
  const dirs: string[] = [];

  for (const dirName of USER_DIR_NAMES) {
    const dirPath = join(home, dirName);
    if (existsSync(dirPath)) {
      dirs.push(dirPath);
    }
  }

  return dirs;
}

// ============ Subdirectory Access ============

/**
 * Get paths to a specific subdirectory in all config locations
 * Returns paths in priority order (lowest to highest)
 */
export function getConfigSubdirPaths(
  subdirName: string,
  options?: { projectPath?: string; includeUser?: boolean; includeProject?: boolean }
): string[] {
  const { projectPath, includeUser = true, includeProject = true } = options || {};
  const paths: string[] = [];

  // User directories (lower priority)
  if (includeUser) {
    const home = homedir();
    // Add in reverse priority order (so later entries override earlier)
    for (const dirName of [...USER_DIR_NAMES].reverse()) {
      paths.push(join(home, dirName, subdirName));
    }
  }

  // Project directories (higher priority)
  if (includeProject) {
    const cwd = projectPath || process.cwd();
    for (const dirName of [...PROJECT_DIR_NAMES].reverse()) {
      paths.push(join(cwd, dirName, subdirName));
    }
  }

  return paths;
}

/**
 * Get all existing paths to a specific subdirectory
 */
export function getExistingConfigSubdirPaths(
  subdirName: string,
  options?: { projectPath?: string; includeUser?: boolean; includeProject?: boolean }
): string[] {
  return getConfigSubdirPaths(subdirName, options).filter(existsSync);
}

// ============ File Access ============

/**
 * Find a file in config directories (returns first match by priority)
 */
export function findConfigFile(
  fileName: string,
  options?: { projectPath?: string; includeUser?: boolean; includeProject?: boolean }
): string | null {
  const { projectPath, includeUser = true, includeProject = true } = options || {};

  // Check project directories first (higher priority)
  if (includeProject) {
    const cwd = projectPath || process.cwd();
    for (const dirName of PROJECT_DIR_NAMES) {
      const filePath = join(cwd, dirName, fileName);
      if (existsSync(filePath)) {
        return filePath;
      }
    }
  }

  // Check user directories
  if (includeUser) {
    const home = homedir();
    for (const dirName of USER_DIR_NAMES) {
      const filePath = join(home, dirName, fileName);
      if (existsSync(filePath)) {
        return filePath;
      }
    }
  }

  return null;
}

/**
 * Read a config file from the first available location
 */
export function readConfigFile(
  fileName: string,
  options?: { projectPath?: string; includeUser?: boolean; includeProject?: boolean }
): string | null {
  const filePath = findConfigFile(fileName, options);

  if (filePath) {
    try {
      return readFileSync(filePath, "utf-8");
    } catch (error) {
      log.debug("Failed to read config file", { filePath, error });
    }
  }

  return null;
}

/**
 * Get all files with a specific name from all config locations
 * Returns in priority order (lowest to highest)
 */
export function getAllConfigFiles(
  fileName: string,
  options?: { projectPath?: string; includeUser?: boolean; includeProject?: boolean }
): Array<{ path: string; content: string }> {
  const { projectPath, includeUser = true, includeProject = true } = options || {};
  const files: Array<{ path: string; content: string }> = [];

  const checkAndAdd = (dirPath: string) => {
    const filePath = join(dirPath, fileName);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        files.push({ path: filePath, content });
      } catch (error) {
        log.debug("Failed to read config file", { filePath, error });
      }
    }
  };

  // User directories (lower priority, added first)
  if (includeUser) {
    const home = homedir();
    for (const dirName of [...USER_DIR_NAMES].reverse()) {
      checkAndAdd(join(home, dirName));
    }
  }

  // Project directories (higher priority, added last)
  if (includeProject) {
    const cwd = projectPath || process.cwd();
    for (const dirName of [...PROJECT_DIR_NAMES].reverse()) {
      checkAndAdd(join(cwd, dirName));
    }
  }

  return files;
}

// ============ CLAUDE.md / Instructions ============

/**
 * Find project instructions file (CLAUDE.md)
 * Checks both root and config directories
 */
export function findProjectInstructions(projectPath?: string): string | null {
  const cwd = projectPath || process.cwd();

  // Check root CLAUDE.md first
  const rootClaudeMd = join(cwd, "CLAUDE.md");
  if (existsSync(rootClaudeMd)) {
    return rootClaudeMd;
  }

  // Check config directories
  for (const dirName of PROJECT_DIR_NAMES) {
    const configClaudeMd = join(cwd, dirName, "CLAUDE.md");
    if (existsSync(configClaudeMd)) {
      return configClaudeMd;
    }
  }

  return null;
}

/**
 * Read project instructions
 */
export function readProjectInstructions(projectPath?: string): string | null {
  const filePath = findProjectInstructions(projectPath);

  if (filePath) {
    try {
      return readFileSync(filePath, "utf-8");
    } catch (error) {
      log.debug("Failed to read project instructions", { filePath, error });
    }
  }

  return null;
}

// ============ Commands Directory ============

/**
 * Get paths to commands directories
 */
export function getCommandsDirPaths(projectPath?: string): string[] {
  return getConfigSubdirPaths("commands", { projectPath });
}

/**
 * Get existing commands directories
 */
export function getExistingCommandsDirs(projectPath?: string): string[] {
  return getExistingConfigSubdirPaths("commands", { projectPath });
}

/**
 * Load all command files from config directories
 * Returns map of command name to file content
 */
export function loadCommandFiles(projectPath?: string): Map<string, { path: string; content: string }> {
  const commands = new Map<string, { path: string; content: string }>();
  const dirs = getExistingCommandsDirs(projectPath);

  for (const dir of dirs) {
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const name = file.replace(/\.md$/, "");
        const filePath = join(dir, file);
        try {
          const content = readFileSync(filePath, "utf-8");
          // Later entries override earlier (higher priority)
          commands.set(name, { path: filePath, content });
        } catch (error) {
          log.debug("Failed to read command file", { filePath, error });
        }
      }
    } catch (error) {
      log.debug("Failed to read commands directory", { dir, error });
    }
  }

  return commands;
}

// ============ Skills Directory ============

/**
 * Get paths to skills directories
 */
export function getSkillsDirPaths(projectPath?: string): string[] {
  return getConfigSubdirPaths("skills", { projectPath });
}

/**
 * Get existing skills directories
 */
export function getExistingSkillsDirs(projectPath?: string): string[] {
  return getExistingConfigSubdirPaths("skills", { projectPath });
}
