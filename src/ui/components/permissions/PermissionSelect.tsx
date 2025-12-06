/**
 * PermissionSelect component - simplified selector for permission requests
 *
 * Uses keyboard navigation (j/k or arrow keys) and Enter to select
 */
import * as React from 'react';
import { Box, Text, useInput } from 'ink';
import { getTheme } from '../../utils/theme.js';

export interface PermissionOption {
  label: string;
  value: string;
}

interface Props {
  options: PermissionOption[];
  onChange: (value: string) => void;
}

export function PermissionSelect({ options, onChange }: Props): React.ReactNode {
  const theme = getTheme();
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(options.length - 1, prev + 1));
    } else if (key.return) {
      onChange(options[selectedIndex].value);
    } else if (key.escape) {
      // Find and trigger the 'no' option
      const noOption = options.find(opt => opt.value === 'no');
      if (noOption) {
        onChange('no');
      }
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      {options.map((option, index) => (
        <Box key={option.value}>
          <Text color={index === selectedIndex ? theme.primary : undefined}>
            {index === selectedIndex ? '❯ ' : '  '}
            {option.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
