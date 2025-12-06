/**
 * BashPermissionRequest component
 *
 * Permission request for bash command execution
 * Supports "don't ask again" options for prefix or full command
 */
import * as React from 'react';
import { Box, Text } from 'ink';
import { getTheme } from '../../utils/theme.js';
import { PermissionRequestTitle } from './PermissionRequestTitle.js';
import { PermissionSelect, type PermissionOption } from './PermissionSelect.js';
import type { ToolConfirmation } from '../../types/messages.js';
import { getCommandPrefix } from '../../../core/permissions.js';

export interface PermissionResponse {
  approved: boolean;
  savePermission?: 'prefix' | 'full' | false;
}

interface Props {
  tool: ToolConfirmation;
  onApprove: (response?: PermissionResponse) => void;
  onReject: () => void;
}

export function BashPermissionRequest({
  tool,
  onApprove,
  onReject,
}: Props): React.ReactNode {
  const theme = getTheme();
  const command = typeof tool.args === 'object' && tool.args !== null
    ? (tool.args as Record<string, unknown>).command as string || JSON.stringify(tool.args)
    : String(tool.args);

  // Get command prefix for "don't ask again" option
  const prefix = getCommandPrefix(command);
  const cwd = process.cwd();
  const cwdShort = cwd.length > 30 ? '...' + cwd.slice(-27) : cwd;

  // Build options
  const options: PermissionOption[] = [
    { label: 'Yes', value: 'yes' },
  ];

  // Add "don't ask again for prefix" option if we have a prefix
  if (prefix) {
    options.push({
      label: `Yes, and don't ask again for ${prefix} commands in ${cwdShort}`,
      value: 'yes-prefix',
    });
  }

  // Add "don't ask again for full command" option
  const commandShort = command.length > 40 ? command.slice(0, 37) + '...' : command;
  options.push({
    label: `Yes, and don't ask again for "${commandShort}" in ${cwdShort}`,
    value: 'yes-full',
  });

  options.push({
    label: 'No, and provide instructions (esc)',
    value: 'no',
  });

  const handleChange = (value: string) => {
    switch (value) {
      case 'yes':
        onApprove({ approved: true });
        break;
      case 'yes-prefix':
        onApprove({ approved: true, savePermission: 'prefix' });
        break;
      case 'yes-full':
        onApprove({ approved: true, savePermission: 'full' });
        break;
      default:
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
      <PermissionRequestTitle title="Bash command" />
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color={theme.bashBorder}>$ {command}</Text>
      </Box>
      <Box flexDirection="column">
        <Text>Do you want to proceed?</Text>
        <PermissionSelect options={options} onChange={handleChange} />
      </Box>
    </Box>
  );
}
