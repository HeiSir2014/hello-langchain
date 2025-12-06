/**
 * PermissionRequestTitle component
 */
import * as React from 'react';
import { Box, Text } from 'ink';
import { getTheme } from '../../utils/theme.js';

export type RiskLevel = 'low' | 'moderate' | 'high';

export function colorForRiskLevel(level: RiskLevel): string {
  const theme = getTheme();
  switch (level) {
    case 'low':
      return theme.success;
    case 'moderate':
      return theme.warning;
    case 'high':
      return theme.error;
  }
}

export function PermissionRiskBadge({
  level,
}: {
  level: RiskLevel;
}): React.ReactNode {
  return <Text color={colorForRiskLevel(level)}>Risk: {level}</Text>;
}

type Props = {
  title: string;
  riskLevel?: RiskLevel;
};

export function PermissionRequestTitle({
  title,
  riskLevel,
}: Props): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text bold color={getTheme().permission}>
        {title}
      </Text>
      {riskLevel && <PermissionRiskBadge level={riskLevel} />}
    </Box>
  );
}
