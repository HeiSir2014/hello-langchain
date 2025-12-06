/**
 * FallbackPermissionRequest component
 *
 * Generic permission request for tools without specific UI
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

export function FallbackPermissionRequest({
  tool,
  onApprove,
  onReject,
}: Props): React.ReactNode {
  const theme = getTheme();
  const cwd = process.cwd();
  const cwdShort = cwd.length > 30 ? '...' + cwd.slice(-27) : cwd;

  const options: PermissionOption[] = [
    { label: 'Yes', value: 'yes' },
    { label: `Yes, and don't ask again for ${tool.name} in ${cwdShort}`, value: 'yes-dont-ask-again' },
    { label: 'No, and provide instructions (esc)', value: 'no' },
  ];

  const handleChange = (value: string) => {
    if (value === 'yes') {
      onApprove({ approved: true });
    } else if (value === 'yes-dont-ask-again') {
      onApprove({ approved: true, savePermission: 'full' });
    } else {
      onReject();
    }
  };

  // Format args for display
  const argsString = typeof tool.args === 'object'
    ? JSON.stringify(tool.args, null, 2)
    : String(tool.args);

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
      <PermissionRequestTitle title="Tool use" />
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>{tool.name}</Text>
        <Text color={theme.secondaryText}>
          {argsString.length > 200 ? argsString.slice(0, 200) + '...' : argsString}
        </Text>
      </Box>
      <Box flexDirection="column">
        <Text>Do you want to proceed?</Text>
        <PermissionSelect options={options} onChange={handleChange} />
      </Box>
    </Box>
  );
}
