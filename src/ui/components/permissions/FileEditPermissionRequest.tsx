/**
 * FileEditPermissionRequest component
 *
 * Permission request for file edit operations with diff preview
 */
import * as React from 'react';
import { Box, Text } from 'ink';
import { basename } from 'path';
import { getTheme } from '../../utils/theme.js';
import { PermissionRequestTitle } from './PermissionRequestTitle.js';
import { PermissionSelect, type PermissionOption } from './PermissionSelect.js';
import type { ToolConfirmation } from '../../types/messages.js';

interface Props {
  tool: ToolConfirmation;
  onApprove: (response?: any) => void;
  onReject: () => void;
}

export function FileEditPermissionRequest({
  tool,
  onApprove,
  onReject,
}: Props): React.ReactNode {
  const theme = getTheme();
  const args = tool.args as Record<string, unknown>;
  const filePath = (args.file_path as string) || 'unknown';
  const oldString = (args.old_string as string) || '';
  const newString = (args.new_string as string) || '';

  const options: PermissionOption[] = [
    { label: 'Yes', value: 'yes' },
    { label: "Yes, and don't ask again this session", value: 'yes-dont-ask-again' },
    { label: 'No, and provide instructions (esc)', value: 'no' },
  ];

  const handleChange = (value: string) => {
    if (value === 'yes') {
      onApprove({ approved: true });
    } else if (value === 'yes-dont-ask-again') {
      onApprove({ approved: true, savePermission: 'session' });
    } else {
      onReject();
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.permission}
      marginTop={1}
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
    >
      <PermissionRequestTitle title="Edit file" />
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.secondaryBorder}
        paddingX={1}
        marginY={1}
      >
        <Text bold>{basename(filePath)}</Text>
        {oldString && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.diff.removed}>- {truncateString(oldString, 100)}</Text>
          </Box>
        )}
        {newString && (
          <Box flexDirection="column">
            <Text color={theme.diff.added}>+ {truncateString(newString, 100)}</Text>
          </Box>
        )}
      </Box>
      <Box flexDirection="column">
        <Text>
          Do you want to make this edit to <Text bold>{basename(filePath)}</Text>?
        </Text>
        <PermissionSelect options={options} onChange={handleChange} />
      </Box>
    </Box>
  );
}

function truncateString(str: string, maxLen: number): string {
  const lines = str.split('\n');
  if (lines.length > 5) {
    return lines.slice(0, 5).join('\n') + '\n...';
  }
  if (str.length > maxLen) {
    return str.slice(0, maxLen) + '...';
  }
  return str;
}
