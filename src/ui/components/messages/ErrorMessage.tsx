/**
 * ErrorMessage component
 */
import { Box, Text } from 'ink';
import React from 'react';
import { getTheme } from '../../utils/theme.js';

interface ErrorMessageProps {
  content: string;
}

export function ErrorMessage({ content }: ErrorMessageProps): React.ReactNode {
  const theme = getTheme();

  return (
    <Text>
      &nbsp;&nbsp;⎿ &nbsp;
      <Text color={theme.error}>{content}</Text>
    </Text>
  );
}
