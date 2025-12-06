/**
 * FilesystemPermissionRequest component
 *
 * Permission request for filesystem operations (Glob, Grep, LS, Read)
 */
import * as React from 'react';
import { Box, Text } from 'ink';
import { getTheme } from '../../utils/theme.js';
import { PermissionRequestTitle } from './PermissionRequestTitle.js';
import { PermissionSelect, type PermissionOption } from './PermissionSelect.js';
import type { ToolConfirmation } from '../../types/messages.js';

interface Props {
  tool: ToolConfirmation;
  onApprove: (response?: any) => void;
  onReject: () => void;
}

export function FilesystemPermissionRequest({
  tool,
  onApprove,
  onReject,
}: Props): React.ReactNode {
  const theme = getTheme();
  const args = tool.args as Record<string, unknown>;

  // Determine the path from various possible arg names
  const path = (args.file_path || args.path || args.notebook_path || process.cwd()) as string;

  // Determine if this is a read or write operation based on tool name
  const isReadOnly = ['Read', 'Glob', 'Grep', 'LS'].includes(tool.name);
  const title = isReadOnly ? 'Read files' : 'Edit files';

  const options: PermissionOption[] = [
    { label: 'Yes', value: 'yes' },
    { label: 'No, and provide instructions (esc)', value: 'no' },
  ];

  const handleChange = (value: string) => {
    if (value === 'yes') {
      onApprove({ approved: true });
    } else {
      onReject();
    }
  };

  // Format the tool call display
  const argsDisplay = Object.entries(args)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ');

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
      <PermissionRequestTitle title={title} />
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>
          {tool.name}({argsDisplay.length > 80 ? argsDisplay.slice(0, 80) + '...' : argsDisplay})
        </Text>
      </Box>
      <Box flexDirection="column">
        <Text>Do you want to proceed?</Text>
        <PermissionSelect options={options} onChange={handleChange} />
      </Box>
    </Box>
  );
}
