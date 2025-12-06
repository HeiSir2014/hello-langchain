/**
 * BashInputMessage component UserBashInputMessage
 */
import { Box, Text } from 'ink';
import React from 'react';
import { getTheme } from '../../utils/theme.js';

interface BashInputMessageProps {
  command: string;
  addMargin?: boolean;
}

export function BashInputMessage({
  command,
  addMargin = true,
}: BashInputMessageProps): React.ReactNode {
  const theme = getTheme();

  if (!command) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0} width="100%">
      <Box>
        <Text color={theme.bashBorder}>!</Text>
        <Text color={theme.secondaryText}> {command}</Text>
      </Box>
    </Box>
  );
}
