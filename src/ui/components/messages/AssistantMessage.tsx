/**
 * AssistantMessage component AssistantTextMessage
 */
import { Box, Text } from 'ink';
import React from 'react';
import { getTheme, BLACK_CIRCLE } from '../../utils/theme.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { applyMarkdown } from '../../utils/markdown.js';

interface AssistantMessageProps {
  content: string;
  addMargin?: boolean;
  shouldShowDot?: boolean;
}

export function AssistantMessage({
  content,
  addMargin = true,
  shouldShowDot = true,
}: AssistantMessageProps): React.ReactNode {
  const theme = getTheme();
  const { columns } = useTerminalSize();

  if (!content || !content.trim()) {
    return null;
  }

  return (
    <Box
      alignItems="flex-start"
      flexDirection="row"
      justifyContent="space-between"
      marginTop={addMargin ? 1 : 0}
      width="100%"
    >
      <Box flexDirection="row">
        {shouldShowDot && (
          <Box minWidth={2}>
            <Text color={theme.text}>{BLACK_CIRCLE}</Text>
          </Box>
        )}
        <Box flexDirection="column" width={columns - 6}>
          <Text>{applyMarkdown(content)}</Text>
        </Box>
      </Box>
    </Box>
  );
}
