/**
 * Bash Tool
 *
 * Executes shell commands using a persistent shell session.
 * Supports cancellation via AbortController.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { EOL } from "os";
import { log } from "../../logger.js";
import { PersistentShell } from "../utils/PersistentShell.js";
import { getToolAbortSignal, isToolAborted, emitToolProgress, getCurrentToolCallId } from "../agent/events.js";

// Constants
const MAX_OUTPUT_LENGTH = 30000;

// Banned commands for security
const BANNED_COMMANDS = [
  'alias',
  'curl',
  'curlie',
  'wget',
  'axel',
  'aria2c',
  'nc',
  'telnet',
  'lynx',
  'w3m',
  'links',
  'httpie',
  'xh',
  'http-prompt',
  'chrome',
  'firefox',
  'safari',
];

/**
 * Format output - truncate if too long
 */
function formatOutput(content: string): {
  totalLines: number;
  truncatedContent: string;
} {
  if (content.length <= MAX_OUTPUT_LENGTH) {
    return {
      totalLines: content.split('\n').length,
      truncatedContent: content,
    };
  }
  const halfLength = MAX_OUTPUT_LENGTH / 2;
  const start = content.slice(0, halfLength);
  const end = content.slice(-halfLength);
  const truncated = `${start}\n\n... [${content.slice(halfLength, -halfLength).split('\n').length} lines truncated] ...\n\n${end}`;

  return {
    totalLines: content.split('\n').length,
    truncatedContent: truncated,
  };
}

/**
 * Split command into individual commands (handles ; and &&)
 */
function splitCommand(command: string): string[] {
  // Simple split - doesn't handle quoted strings perfectly but good enough
  return command.split(/\s*(?:;|&&)\s*/).filter(Boolean);
}

/**
 * Validate command - check for banned commands
 */
function validateCommand(command: string): { valid: boolean; message?: string } {
  const commands = splitCommand(command);
  for (const cmd of commands) {
    const parts = cmd.trim().split(/\s+/);
    const baseCmd = parts[0];

    if (baseCmd && BANNED_COMMANDS.includes(baseCmd.toLowerCase())) {
      return {
        valid: false,
        message: `Command '${baseCmd}' is not allowed for security reasons`,
      };
    }
  }
  return { valid: true };
}

/**
 * Render result for assistant
 */
function renderResultForAssistant(data: {
  stdout: string;
  stderr: string;
  interrupted: boolean;
}): string {
  let errorMessage = data.stderr.trim();
  if (data.interrupted) {
    if (data.stderr) errorMessage += EOL;
    errorMessage += '<error>Command was aborted before completion</error>';
  }
  const hasBoth = data.stdout.trim() && errorMessage;
  return `${data.stdout.trim()}${hasBoth ? '\n' : ''}${errorMessage.trim()}`;
}

// Bash Tool
export const Bash = tool(
  async ({ command, timeout = 120000 }) => {
    const startTime = Date.now();
    log.toolStart("Bash", { command, timeout });

    // Validate command
    const validation = validateCommand(command);
    if (!validation.valid) {
      log.toolError("Bash", validation.message || "Invalid command");
      return validation.message || "Command not allowed";
    }

    // Get abort signal
    const abortSignal = getToolAbortSignal();

    // Check if already cancelled
    if (abortSignal?.aborted || isToolAborted()) {
      const durationMs = Date.now() - startTime;
      log.toolEnd("Bash", durationMs, 0);
      return "Command cancelled before execution";
    }

    try {
      // Output callback for real-time streaming
      const onOutput = (stdout: string, stderr: string) => {
        const toolCallId = getCurrentToolCallId('Bash');
        if (toolCallId) {
          const output = stdout + (stderr ? `\n${stderr}` : '');
          emitToolProgress('Bash', toolCallId, output);
        }
      };

      // Execute command using PersistentShell
      const result = await PersistentShell.getInstance().exec(
        command,
        abortSignal || undefined,
        timeout,
        onOutput,
      );

      const stdout = (result.stdout || '').trim();
      const stderr = (result.stderr || '').trim();
      let finalStderr = stderr;

      if (result.code !== 0 && !result.interrupted) {
        finalStderr = stderr ? `${stderr}${EOL}Exit code ${result.code}` : `Exit code ${result.code}`;
      }

      // Format output
      const { totalLines: stdoutLines, truncatedContent: stdoutContent } =
        formatOutput(stdout);
      const { totalLines: stderrLines, truncatedContent: stderrContent } =
        formatOutput(finalStderr);

      const durationMs = Date.now() - startTime;
      log.toolEnd("Bash", durationMs, stdout.length + stderr.length);

      // Return formatted result
      const data = {
        stdout: stdoutContent,
        stdoutLines,
        stderr: stderrContent,
        stderrLines,
        interrupted: result.interrupted,
      };

      return renderResultForAssistant(data);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const isAborted = abortSignal?.aborted || isToolAborted();
      const errorMessage = isAborted
        ? 'Command was cancelled by user'
        : `Command failed: ${error instanceof Error ? error.message : String(error)}`;

      log.toolError("Bash", errorMessage);

      return renderResultForAssistant({
        stdout: '',
        stderr: errorMessage,
        interrupted: isAborted,
      });
    }
  },
  {
    name: "Bash",
    description: `Executes a given bash command in a persistent shell session with optional timeout.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use the LS tool to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use LS to check that "foo" exists and is the intended parent directory

2. Security Check:
   - Some commands are banned for security: ${BANNED_COMMANDS.join(', ')}.
   - If you use a disallowed command, you will receive an error message.

3. Command Execution:
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

4. Output Processing:
   - If the output exceeds ${MAX_OUTPUT_LENGTH} characters, output will be truncated.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). Default is 120000ms (2 minutes).
  - VERY IMPORTANT: Avoid using search commands like \`find\` and \`grep\`. Use Grep, Glob tools instead.
  - Avoid using \`cat\`, \`head\`, \`tail\`, use Read tool instead.
  - When issuing multiple commands, use ';' or '&&' to separate them. DO NOT use newlines.
  - IMPORTANT: All commands share the same shell session. Shell state (environment variables, virtual environments, current directory, etc.) persist between commands.
  - Try to maintain your current working directory by using absolute paths and avoiding \`cd\`.

# Committing changes with git

When the user asks you to create a new git commit:
1. Run git status, git diff, and git log in parallel to understand the changes
2. Analyze changes and draft a commit message
3. Create the commit using HEREDOC format:
   git commit -m "$(cat <<'EOF'
   Commit message here.

   🤖 Generated with YTerm
   EOF
   )"

Important:
- NEVER update the git config
- DO NOT push to the remote repository unless asked
- Never use interactive git commands (-i flag)`,
    schema: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.coerce.number().optional().describe("Optional timeout in milliseconds (max 600000, default 120000)"),
    }),
  }
);

// BashOutput Tool - for checking background shell output (kept for compatibility)
export const BashOutput = tool(
  async ({ bash_id }) => {
    log.toolStart("BashOutput", { bash_id });
    // With PersistentShell, we don't have background shells anymore
    // This is kept for API compatibility but returns an error
    return `Error: Background shells are no longer supported. Use run_in_background parameter instead.`;
  },
  {
    name: "BashOutput",
    description: `[DEPRECATED] Background shells are no longer supported with PersistentShell.`,
    schema: z.object({
      bash_id: z.string().describe("The ID of the background shell"),
    }),
  }
);

// KillShell Tool - for killing background shells (kept for compatibility)
export const KillShell = tool(
  async ({ shell_id }) => {
    log.toolStart("KillShell", { shell_id });
    // With PersistentShell, use the abort signal instead
    return `Error: Use Escape key or abort signal to cancel running commands.`;
  },
  {
    name: "KillShell",
    description: `[DEPRECATED] Use Escape key to cancel running commands.`,
    schema: z.object({
      shell_id: z.string().describe("The ID of the shell to kill"),
    }),
  }
);
