/**
 * Bash execution utilities for UI
 * Uses the same PersistentShell as the agent for consistent state
 */
import { PersistentShell, type OutputCallback } from '../../core/utils/PersistentShell.js';

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  isError: boolean;
  interrupted: boolean;
}

export interface BashExecuteOptions {
  abortSignal?: AbortSignal;
  timeout?: number;
  onOutput?: OutputCallback;
}

/**
 * Execute a bash command using the shared PersistentShell
 * This ensures both LLM and user bash commands share the same shell state
 *
 * @param command - The command to execute
 * @param options - Optional execution options (abortSignal, timeout, onOutput callback)
 */
export async function executeBashCommand(
  command: string,
  options?: BashExecuteOptions,
): Promise<BashResult> {
  try {
    const shell = PersistentShell.getInstance();
    const result = await shell.exec(
      command,
      options?.abortSignal,
      options?.timeout ?? 60000,
      options?.onOutput,
    );

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      isError: result.code !== 0,
      interrupted: result.interrupted,
    };
  } catch (error: any) {
    return {
      stdout: '',
      stderr: error.message,
      exitCode: 1,
      isError: true,
      interrupted: false,
    };
  }
}
