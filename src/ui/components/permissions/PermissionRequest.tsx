/**
 * PermissionRequest component
 *
 * Main permission request component that routes to the appropriate
 * tool-specific permission request component.
 */
import * as React from 'react';
import { useInput } from 'ink';
import type { ToolConfirmation } from '../../types/messages.js';
import { BashPermissionRequest, type PermissionResponse } from './BashPermissionRequest.js';
import { FileEditPermissionRequest } from './FileEditPermissionRequest.js';
import { FileWritePermissionRequest } from './FileWritePermissionRequest.js';
import { FilesystemPermissionRequest } from './FilesystemPermissionRequest.js';
import { FallbackPermissionRequest } from './FallbackPermissionRequest.js';

export interface PermissionRequestProps {
  tools: ToolConfirmation[];
  onApprove: (response?: PermissionResponse) => void;
  onReject: () => void;
}

// Re-export PermissionResponse type
export type { PermissionResponse };

/**
 * Get the appropriate permission component for a tool
 */
function getPermissionComponent(toolName: string) {
  const normalizedName = toolName.toLowerCase();

  if (normalizedName.includes('bash') || normalizedName === 'bash') {
    return BashPermissionRequest;
  }
  if (normalizedName.includes('edit') || normalizedName === 'edit') {
    return FileEditPermissionRequest;
  }
  if (normalizedName.includes('write') || normalizedName === 'write') {
    return FileWritePermissionRequest;
  }
  if (
    normalizedName.includes('read') ||
    normalizedName.includes('glob') ||
    normalizedName.includes('grep') ||
    normalizedName.includes('ls')
  ) {
    return FilesystemPermissionRequest;
  }

  return FallbackPermissionRequest;
}

export function PermissionRequest({
  tools,
  onApprove,
  onReject,
}: PermissionRequestProps): React.ReactNode {
  // Handle Ctrl+C to reject
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onReject();
    }
  });

  // For now, just handle the first tool
  // In the future, we could support multiple tool confirmations
  const tool = tools[0];
  if (!tool) {
    return null;
  }

  const PermissionComponent = getPermissionComponent(tool.name);

  return (
    <PermissionComponent
      tool={tool}
      onApprove={onApprove}
      onReject={onReject}
    />
  );
}
