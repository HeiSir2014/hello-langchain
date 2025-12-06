/**
 * SystemMessage component
 */
import { Box, Text } from 'ink';
import React from 'react';
import { getTheme } from '../../utils/theme.js';

interface SystemMessageProps {
  content: string;
}

export function SystemMessage({ content }: SystemMessageProps): React.ReactNode {
  const theme = getTheme();

  return (
    <Box marginTop={1} flexDirection="row">
      <Box minWidth={2}>
        <Text color={theme.secondaryText}>ℹ</Text>
      </Box>
      <Text color={theme.secondaryText} italic>{content}</Text>
    </Box>
  );
}
