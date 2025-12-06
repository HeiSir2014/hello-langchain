/**
 * Bash execution utilities for UI
 * Uses the same PersistentShell as the agent for consistent state
 */
import { PersistentShell } from '../../core/utils/PersistentShell.js';

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  isError: boolean;
}

/**
 * Execute a bash command using the shared PersistentShell
 * This ensures both LLM and user bash commands share the same shell state
 */
export async function executeBashCommand(command: string): Promise<BashResult> {
  try {
    const shell = PersistentShell.getInstance();
    const result = await shell.exec(command, undefined, 60000);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      isError: result.code !== 0,
    };
  } catch (error: any) {
    return {
      stdout: '',
      stderr: error.message,
      exitCode: 1,
      isError: true,
    };
  }
}
