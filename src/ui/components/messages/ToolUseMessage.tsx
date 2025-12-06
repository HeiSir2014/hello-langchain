/**
 * ToolUseMessage component AssistantToolUseMessage
 *
 * Displays tool execution with command details, not just dots
 */
import { Box, Text } from 'ink';
import React from 'react';
import { relative } from 'path';
import { getTheme, BLACK_CIRCLE } from '../../utils/theme.js';
import { SimpleSpinner } from '../Spinner.js';

interface ToolUseMessageProps {
  name: string;
  args: Record<string, unknown>;
  isInProgress?: boolean;
  addMargin?: boolean;
  shouldShowDot?: boolean;
}

export function ToolUseMessage({
  name,
  args,
  isInProgress = false,
  addMargin = true,
  shouldShowDot = true,
}: ToolUseMessageProps): React.ReactNode {
  const theme = getTheme();

  // Format args for display - show more details
  const { summary, details } = formatToolDisplay(name, args);

  return (
    <Box
      flexDirection="column"
      marginTop={addMargin ? 1 : 0}
      width="100%"
    >
      {/* Tool name row */}
      <Box flexDirection="row">
        {shouldShowDot && (
          isInProgress ? (
            <SimpleSpinner />
          ) : (
            <Box minWidth={2}>
              <Text color={theme.text}>{BLACK_CIRCLE}</Text>
            </Box>
          )
        )}
        <Text bold color={theme.tool}>{name}</Text>
        {summary && (
          <Text color={theme.secondaryText}> {summary}</Text>
        )}
      </Box>
      {/* Details row (for commands, file paths, etc.) */}
      {details && (
        <Box marginLeft={2} flexDirection="column">
          <Text color={theme.dim}>{details}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Convert absolute path to relative path if within cwd
 */
function toRelativePath(filePath: string): string {
  const cwd = process.cwd();
  const rel = relative(cwd, filePath);
  // If relative path starts with "..", it's outside cwd, keep absolute
  // If relative path is empty, it's the cwd itself
  if (rel.startsWith('..') || rel === '') {
    return filePath;
  }
  return rel;
}

/**
 * Format tool display with summary and details
 * Shows meaningful information for each tool type
 */
function formatToolDisplay(toolName: string, args: Record<string, unknown>): {
  summary: string;
  details: string | null;
} {
  switch (toolName) {
    case 'Bash': {
      const command = args.command as string | undefined;
      const description = args.description as string | undefined;
      return {
        summary: description ? `- ${description}` : '',
        details: command ? `$ ${truncateMiddle(command, 120)}` : null,
      };
    }

    case 'Read': {
      const filePath = args.file_path as string | undefined;
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      let summary = filePath ? toRelativePath(filePath) : '';
      if (offset || limit) {
        summary += ` (${offset ? `offset: ${offset}` : ''}${offset && limit ? ', ' : ''}${limit ? `limit: ${limit}` : ''})`;
      }
      return { summary, details: null };
    }

    case 'Write': {
      const filePath = args.file_path as string | undefined;
      const content = args.content as string | undefined;
      return {
        summary: filePath ? toRelativePath(filePath) : '',
        details: content ? `${content.split('\n').length} lines, ${content.length} chars` : null,
      };
    }

    case 'Edit': {
      const filePath = args.file_path as string | undefined;
      const oldString = args.old_string as string | undefined;
      const newString = args.new_string as string | undefined;
      const replaceAll = args.replace_all as boolean | undefined;
      return {
        summary: `${filePath ? toRelativePath(filePath) : ''}${replaceAll ? ' (replace all)' : ''}`,
        details: oldString && newString
          ? `"${truncate(oldString, 40)}" → "${truncate(newString, 40)}"`
          : null,
      };
    }

    case 'Glob': {
      const pattern = args.pattern as string | undefined;
      const path = args.path as string | undefined;
      return {
        summary: pattern || '',
        details: path ? `in ${toRelativePath(path)}` : null,
      };
    }

    case 'Grep': {
      const pattern = args.pattern as string | undefined;
      const path = args.path as string | undefined;
      const glob = args.glob as string | undefined;
      return {
        summary: pattern ? `"${truncate(pattern, 40)}"` : '',
        details: [
          path ? `in ${toRelativePath(path)}` : null,
          glob ? `files: ${glob}` : null,
        ].filter(Boolean).join(', ') || null,
      };
    }

    case 'LS': {
      const path = args.path as string | undefined;
      return {
        summary: path ? toRelativePath(path) : '.',
        details: null,
      };
    }

    case 'TodoWrite': {
      const todos = args.todos as any[] | undefined;
      return {
        summary: todos ? `${todos.length} items` : '',
        details: null,
      };
    }

    case 'BashOutput': {
      const bashId = args.bash_id as string | undefined;
      return {
        summary: bashId || '',
        details: null,
      };
    }

    case 'KillShell': {
      const shellId = args.shell_id as string | undefined;
      return {
        summary: shellId || '',
        details: null,
      };
    }

    default: {
      // Generic fallback - show all args
      const entries = Object.entries(args);
      if (entries.length === 0) return { summary: '', details: null };

      const summary = entries
        .slice(0, 2)
        .map(([key, value]) => {
          if (typeof value === 'string') {
            return `${key}=${truncate(value, 30)}`;
          }
          return `${key}=${truncate(JSON.stringify(value), 30)}`;
        })
        .join(', ');

      return { summary, details: entries.length > 2 ? `+${entries.length - 2} more args` : null };
    }
  }
}

/**
 * Truncate string at the end
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Truncate string in the middle (useful for long commands)
 */
function truncateMiddle(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return str.slice(0, half) + '...' + str.slice(-half);
}
