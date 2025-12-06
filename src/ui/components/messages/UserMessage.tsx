/**
 * UserMessage component UserPromptMessage
 */
import { Box, Text } from 'ink';
import React from 'react';
import { getTheme } from '../../utils/theme.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';

interface UserMessageProps {
  content: string;
  addMargin?: boolean;
}

export function UserMessage({ content, addMargin = true }: UserMessageProps): React.ReactNode {
  const theme = getTheme();
  const { columns } = useTerminalSize();

  if (!content) {
    return null;
  }

  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} width="100%">
      <Box minWidth={2} width={2}>
        <Text color={theme.secondaryText}>&gt;</Text>
      </Box>
      <Box flexDirection="column" width={columns - 4}>
        <Text color={theme.secondaryText} wrap="wrap">
          {content}
        </Text>
      </Box>
    </Box>
  );
}
