/**
 * Custom Commands Loader
 *
 * Loads custom slash commands from markdown files in:
 * - ~/.yterm/commands/ or ~/.claude/commands/ (user level)
 * - .yterm/commands/ or .claude/commands/ (project level)
 *
 * Command files are markdown with optional YAML frontmatter:
 * ---
 * description: My custom command
 * aliases: [mc, myc]
 * ---
 * The command prompt content goes here.
 * Use $ARGUMENTS to reference command arguments.
 */

import { loadCommandFiles } from "../../core/projectDirs.js";
import { log } from "../../logger.js";
import type { Command, PromptCommand, CommandContext } from "./index.js";

// ============ Types ============

interface CustomCommandConfig {
  description?: string;
  aliases?: string[];
  progressMessage?: string;
}

interface ParsedCommand {
  config: CustomCommandConfig;
  promptTemplate: string;
}

// ============ Parsing ============

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const [, yaml, body] = match;
  const frontmatter: Record<string, any> = {};

  // Simple YAML parsing (key: value)
  for (const line of yaml.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Handle arrays (simple format: [a, b, c])
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1);
      frontmatter[key] = value.split(",").map((v) => v.trim().replace(/['"]/g, ""));
    } else if (value === "true") {
      frontmatter[key] = true;
    } else if (value === "false") {
      frontmatter[key] = false;
    } else {
      frontmatter[key] = value.replace(/['"]/g, "");
    }
  }

  return { frontmatter, body: body.trim() };
}

/**
 * Parse a command file
 */
function parseCommandFile(content: string): ParsedCommand {
  const { frontmatter, body } = parseFrontmatter(content);

  return {
    config: {
      description: frontmatter.description || "Custom command",
      aliases: frontmatter.aliases,
      progressMessage: frontmatter.progressMessage,
    },
    promptTemplate: body,
  };
}

// ============ Command Creation ============

/**
 * Create a Command from parsed command data
 */
function createCommand(name: string, parsed: ParsedCommand, sourcePath: string): Command {
  const { config, promptTemplate } = parsed;

  const command: Command = {
    type: "prompt",
    name,
    description: config.description || "Custom command",
    isEnabled: true,
    isHidden: false,
    aliases: config.aliases,
    progressMessage: config.progressMessage || `Running /${name}...`,

    async getPromptForCommand(args: string, _context: CommandContext) {
      // Replace $ARGUMENTS placeholder with actual args
      let prompt = promptTemplate;
      prompt = prompt.replace(/\$ARGUMENTS/g, args || "");
      prompt = prompt.replace(/\$\{ARGUMENTS\}/g, args || "");

      // Also support numbered arguments like $1, $2
      const argParts = args.split(/\s+/).filter(Boolean);
      for (let i = 0; i < argParts.length; i++) {
        prompt = prompt.replace(new RegExp(`\\$${i + 1}`, "g"), argParts[i]);
        prompt = prompt.replace(new RegExp(`\\$\\{${i + 1}\\}`, "g"), argParts[i]);
      }

      return [{ role: "user" as const, content: prompt }];
    },

    userFacingName() {
      return name;
    },
  };

  log.debug("Created custom command", { name, source: sourcePath, aliases: config.aliases });

  return command;
}

// ============ Loading ============

// Cache for loaded commands
let cachedCommands: Command[] | null = null;
let cacheKey: string | null = null;

/**
 * Get cache key based on current working directory
 */
function getCacheKey(): string {
  return process.cwd();
}

/**
 * Load all custom commands from config directories
 */
export function loadCustomCommands(): Command[] {
  const currentKey = getCacheKey();

  // Return cached if available and cwd hasn't changed
  if (cachedCommands && cacheKey === currentKey) {
    return cachedCommands;
  }

  const commands: Command[] = [];
  const commandFiles = loadCommandFiles();

  for (const [name, { path, content }] of commandFiles) {
    try {
      const parsed = parseCommandFile(content);
      const command = createCommand(name, parsed, path);
      commands.push(command);
    } catch (error: any) {
      log.warn(`Failed to parse command file: ${path}`, { error: error.message });
    }
  }

  // Update cache
  cachedCommands = commands;
  cacheKey = currentKey;

  log.info("Custom commands loaded", { count: commands.length });

  return commands;
}

/**
 * Clear the custom commands cache
 */
export function clearCustomCommandsCache(): void {
  cachedCommands = null;
  cacheKey = null;
}

/**
 * Get a custom command by name
 */
export function getCustomCommand(name: string): Command | undefined {
  const commands = loadCustomCommands();
  return commands.find((cmd) => cmd.name === name || cmd.aliases?.includes(name));
}

/**
 * Check if a custom command exists
 */
export function hasCustomCommand(name: string): boolean {
  return getCustomCommand(name) !== undefined;
}
