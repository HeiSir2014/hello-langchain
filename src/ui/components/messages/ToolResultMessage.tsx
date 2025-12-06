/**
 * ToolResultMessage component - shows tool execution result
 */
import { Box, Text } from 'ink';
import React from 'react';
import { getTheme } from '../../utils/theme.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';

interface ToolResultMessageProps {
  name: string;
  result: string;
  isError?: boolean;
}

export function ToolResultMessage({ name, result, isError }: ToolResultMessageProps): React.ReactNode {
  const theme = getTheme();
  const { columns } = useTerminalSize();

  // Truncate long results
  const maxLength = Math.max(100, columns - 20);
  const displayResult = result.length > maxLength
    ? result.slice(0, maxLength) + '...'
    : result;

  return (
    <Box flexDirection="row" paddingLeft={2}>
      <Text color={theme.secondaryText}>⎿ </Text>
      <Text color={isError ? theme.error : theme.success}>
        {isError ? '✗' : '✓'}
      </Text>
      <Text color={theme.secondaryText}> {name}: </Text>
      <Text color={isError ? theme.error : theme.text} wrap="truncate">
        {displayResult}
      </Text>
    </Box>
  );
}
