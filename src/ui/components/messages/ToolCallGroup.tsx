/**
 * ToolCallGroup component - groups tool_use with its tool_result
 *
 * Displays a tool call and its result together, avoiding scattered display
 * when multiple tools run in parallel.
 */
import { Box, Text } from 'ink';
import React from 'react';
import { ToolUseMessage } from './ToolUseMessage.js';
import { ToolResultMessage } from './ToolResultMessage.js';
import { getTheme } from '../../utils/theme.js';

interface ToolCallGroupProps {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  isInProgress?: boolean;
  streamingOutput?: string;
}

export function ToolCallGroup({
  name,
  args,
  result,
  isError,
  isInProgress = false,
  streamingOutput,
}: ToolCallGroupProps): React.ReactNode {
  const theme = getTheme();

  // Truncate streaming output to last N lines for display
  const formatStreamingOutput = (output: string): string => {
    const lines = output.split('\n');
    const maxLines = 10;
    if (lines.length > maxLines) {
      return `... (${lines.length - maxLines} lines hidden)\n` + lines.slice(-maxLines).join('\n');
    }
    return output;
  };

  return (
    <Box flexDirection="column" width="100%">
      <ToolUseMessage
        name={name}
        args={args}
        isInProgress={isInProgress && !result}
        addMargin={true}
        shouldShowDot={true}
      />
      {/* Show streaming output while tool is executing */}
      {streamingOutput && !result && (
        <Box marginLeft={2} flexDirection="column">
          <Text color={theme.secondaryText}>
            {formatStreamingOutput(streamingOutput)}
          </Text>
        </Box>
      )}
      {result && (
        <ToolResultMessage
          name={name}
          result={result}
          isError={isError}
        />
      )}
    </Box>
  );
}
