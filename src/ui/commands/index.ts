/**
 * Commands system
 *
 * Provides a registry of slash commands with support for
 * local commands, JSX-rendering commands, and command aliases.
 */
import React from 'react';
import clear from './clear.js';
import help from './help.js';
import model from './model.js';
import compact from './compact.js';

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
    onDone: (result?: string) => void,
    context: CommandContext,
  ): Promise<React.ReactNode>;
};

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
  setCurrentModel: (model: string) => void;
  setAgentModel: (model: string) => void;
  setForkNumber: React.Dispatch<React.SetStateAction<number>>;
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
} & (LocalCommand | LocalJSXCommand);

/**
 * All available commands
 */
const COMMANDS: Command[] = [
  clear,
  help,
  model,
  compact,
];

/**
 * Get all enabled commands
 */
export function getCommands(): Command[] {
  return COMMANDS.filter(cmd => cmd.isEnabled);
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
