/**
 * FileWritePermissionRequest component
 *
 * Permission request for file write/create operations
 */
import * as React from 'react';
import { Box, Text } from 'ink';
import { basename } from 'path';
import { existsSync } from 'fs';
import { getTheme } from '../../utils/theme.js';
import { PermissionRequestTitle } from './PermissionRequestTitle.js';
import { PermissionSelect, type PermissionOption } from './PermissionSelect.js';
import type { ToolConfirmation } from '../../types/messages.js';

interface Props {
  tool: ToolConfirmation;
  onApprove: (response?: any) => void;
  onReject: () => void;
}

export function FileWritePermissionRequest({
  tool,
  onApprove,
  onReject,
}: Props): React.ReactNode {
  const theme = getTheme();
  const args = tool.args as Record<string, unknown>;
  const filePath = (args.file_path as string) || 'unknown';
  const content = (args.content as string) || '';
  const fileExists = existsSync(filePath);

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
      <PermissionRequestTitle title={fileExists ? 'Edit file' : 'Create file'} />
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.secondaryBorder}
        paddingX={1}
        marginY={1}
      >
        <Text bold>{basename(filePath)}</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.diff.added}>
            {truncateContent(content)}
          </Text>
        </Box>
      </Box>
      <Box flexDirection="column">
        <Text>
          Do you want to {fileExists ? 'edit' : 'create'}{' '}
          <Text bold>{basename(filePath)}</Text>?
        </Text>
        <PermissionSelect options={options} onChange={handleChange} />
      </Box>
    </Box>
  );
}

function truncateContent(content: string): string {
  const lines = content.split('\n');
  if (lines.length > 10) {
    return lines.slice(0, 10).join('\n') + `\n... (${lines.length - 10} more lines)`;
  }
  return content;
}
