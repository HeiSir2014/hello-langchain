/**
 * Commands system
 *
 * Provides a registry of slash commands with support for:
 * - Local commands (execute and return string)
 * - JSX commands (render React components)
 * - Prompt commands (leverage agent capabilities)
 * - Agent commands (run specialized sub-agents)
 * - Custom commands (loaded from .claude/commands/ or .yterm/commands/)
 */
import React from 'react';
import clear from './clear.js';
import help from './help.js';
import model from './model.js';
import compact from './compact.js';
import init from './init.js';
import plan from './plan.js';
import exitPlan from './exitPlan.js';
import skill from './skill.js';
import resume from './resume.js';
import { loadCustomCommands, clearCustomCommandsCache } from './customLoader.js';

/**
 * Local command - executes and returns a string result
 */
export type LocalCommand = {
  type: 'local';
  call(
    args: string,
    context: CommandContext,
  ): Promise<string>;
};

/**
 * JSX command - renders a React component
 */
export type LocalJSXCommand = {
  type: 'local-jsx';
  call(
    args: string,
    onDone: (result?: string) => void,
    context: CommandContext,
  ): Promise<React.ReactNode>;
};

/**
 * Prompt command - returns a prompt to send to the agent
 * This type allows commands to leverage the full agent capabilities
 */
export type PromptCommand = {
  type: 'prompt';
  /** Progress message shown while the command runs */
  progressMessage?: string;
  /** Get the prompt to send to the agent */
  getPromptForCommand(
    args: string,
    context: CommandContext,
  ): Promise<{ role: 'user'; content: string }[]>;
};

/**
 * Agent command - runs a specialized sub-agent (LangGraph subgraph)
 * This type allows commands to use dedicated agents with custom graphs
 */
export type AgentCommand = {
  type: 'agent';
  /** Progress message shown while the command runs */
  progressMessage?: string;
  /** Run the specialized agent */
  runAgent(
    args: string,
    context: CommandContext,
  ): Promise<{ success: boolean; message: string }>;
};

/**
 * Resume session data for /resume command
 */
export interface ResumeSessionData {
  sessionId: string;
  threadId: string;
  model: string;
  uiMessages: any[];
  langGraphMessages: any[];
}

/**
 * Command context passed to command handlers
 */
export interface CommandContext {
  commands: Command[];
  currentModel: string;
  abortController?: AbortController;
  clearMessages: () => void;
  clearHistory: () => void;
  addSystemMessage: (message: string) => void;
  addUserMessage: (message: string) => void;
  setCurrentModel: (model: string) => void;
  setAgentModel: (model: string) => void;
  setForkNumber: React.Dispatch<React.SetStateAction<number>>;
  setIsLoading: (loading: boolean) => void;
  /** Resume a session (called by /resume command) */
  resumeSession?: (data: ResumeSessionData) => void;
}

/**
 * Command definition
 */
export type Command = {
  name: string;
  description: string;
  isEnabled: boolean;
  isHidden: boolean;
  aliases?: string[];
  userFacingName(): string;
} & (LocalCommand | LocalJSXCommand | PromptCommand | AgentCommand);

/**
 * Built-in commands
 */
const BUILT_IN_COMMANDS: Command[] = [
  clear,
  help,
  model,
  compact,
  init,
  plan,
  exitPlan,
  skill,
  resume,
];

/**
 * Get all enabled commands (built-in + custom)
 * Custom commands are loaded from .claude/commands/ or .yterm/commands/
 */
export function getCommands(): Command[] {
  const builtIn = BUILT_IN_COMMANDS.filter(cmd => cmd.isEnabled);
  const custom = loadCustomCommands();

  // Custom commands can override built-in commands with the same name
  const customNames = new Set(custom.map(cmd => cmd.name));
  const filtered = builtIn.filter(cmd => !customNames.has(cmd.name));

  return [...filtered, ...custom];
}

/**
 * Get only built-in commands
 */
export function getBuiltInCommands(): Command[] {
  return BUILT_IN_COMMANDS.filter(cmd => cmd.isEnabled);
}

/**
 * Reload custom commands (clear cache)
 */
export function reloadCustomCommands(): void {
  clearCustomCommandsCache();
}

/**
 * Check if a command exists
 */
export function hasCommand(commandName: string, commands: Command[]): boolean {
  return commands.some(
    cmd => cmd.userFacingName() === commandName || cmd.aliases?.includes(commandName),
  );
}

/**
 * Get a command by name or alias
 */
export function getCommand(commandName: string, commands: Command[]): Command | undefined {
  return commands.find(
    cmd => cmd.userFacingName() === commandName || cmd.aliases?.includes(commandName),
  );
}
