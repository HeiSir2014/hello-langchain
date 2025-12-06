import React from 'react';
import type { MessageItem } from '../types/messages.js';
import { UserMessage } from './messages/UserMessage.js';
import { AssistantMessage } from './messages/AssistantMessage.js';
import { ToolCallGroup } from './messages/ToolCallGroup.js';
import { ToolResultMessage } from './messages/ToolResultMessage.js';
import { ErrorMessage } from './messages/ErrorMessage.js';
import { SystemMessage } from './messages/SystemMessage.js';
import { BashInputMessage } from './messages/BashInputMessage.js';
import { BashOutputMessage } from './messages/BashOutputMessage.js';

interface MessageProps {
  message: MessageItem;
}

export function Message({ message }: MessageProps): React.ReactNode {
  switch (message.type) {
    case 'user':
      return <UserMessage content={message.content} />;

    case 'assistant':
      return <AssistantMessage content={message.content} />;

    case 'tool_use':
      // Use ToolCallGroup to display tool_use with its result together
      // Pass isInProgress when result is not yet available
      return (
        <ToolCallGroup
          name={message.name}
          args={message.args}
          result={message.result}
          isError={message.isError}
          isInProgress={message.result === undefined}
          streamingOutput={message.streamingOutput}
        />
      );

    case 'tool_result':
      // tool_result is now merged into tool_use, but keep this for backward compatibility
      return (
        <ToolResultMessage
          name={message.name}
          result={message.result}
          isError={message.isError}
        />
      );

    case 'error':
      return <ErrorMessage content={message.content} />;

    case 'system':
      return <SystemMessage content={message.content} />;

    case 'bash_input':
      return <BashInputMessage command={message.command} />;

    case 'bash_output':
      return (
        <BashOutputMessage
          stdout={message.stdout}
          stderr={message.stderr}
          isError={message.isError}
        />
      );

    default:
      return null;
  }
}
