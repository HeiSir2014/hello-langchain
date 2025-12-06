import { useState, useEffect, useCallback, useRef } from 'react';
import { agentEvents, AgentEventType } from '../../core/agent/events.js';
import type { MessageItem, ToolConfirmation } from '../types/messages.js';
import { generateMessageId } from '../types/messages.js';

export function useAgentEvents() {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolConfirm, setToolConfirm] = useState<ToolConfirmation[] | null>(null);
  // Track tool IDs that have received results (used to avoid race conditions)
  const completedToolIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handler = (event: AgentEventType) => {
      switch (event.type) {
        case 'thinking':
          setIsLoading(true);
          setStreamingContent('');
          break;

        case 'streaming':
          setStreamingContent(event.content);
          break;

        case 'tool_use':
          setMessages(prev => [...prev, {
            type: 'tool_use',
            name: event.name,
            args: event.args,
            toolCallId: event.id,
            id: generateMessageId(),
          }]);
          break;

        case 'tool_progress':
          // Update the existing tool_use message with streaming output
          setMessages(prev => prev.map(m => {
            if (m.type === 'tool_use' && m.toolCallId === event.id) {
              return {
                ...m,
                streamingOutput: event.message,
              };
            }
            return m;
          }));
          break;

        case 'tool_result':
          // Track that this tool has received a result (for race condition handling)
          completedToolIds.current.add(event.id);
          // Update the existing tool_use message with the result
          // This avoids reordering the array which would cause Static to re-render
          setMessages(prev => prev.map(m => {
            if (m.type === 'tool_use' && m.toolCallId === event.id) {
              return {
                ...m,
                result: event.result,
                isError: event.isError,
                streamingOutput: undefined, // Clear streaming output
              };
            }
            return m;
          }));
          break;

        case 'response':
          setMessages(prev => [...prev, {
            type: 'assistant',
            content: event.content,
            id: generateMessageId(),
          }]);
          setStreamingContent('');
          break;

        case 'error':
          setMessages(prev => [...prev, {
            type: 'error',
            content: event.message,
            id: generateMessageId(),
          }]);
          break;

        case 'confirm_required':
          setToolConfirm(event.tools);
          break;

        case 'done':
          setIsLoading(false);
          setStreamingContent('');
          // Only mark tools as interrupted if:
          // 1. The done event indicates interruption, AND
          // 2. The tool hasn't received a result (checked via ref to avoid race conditions)
          if (event.interrupted) {
            setMessages(prev => prev.map(m => {
              // Check both state AND ref to handle race conditions
              // The ref is updated synchronously when tool_result is received
              if (m.type === 'tool_use' && m.result === undefined && !completedToolIds.current.has(m.toolCallId || '')) {
                return {
                  ...m,
                  result: m.streamingOutput || '(interrupted)',
                  isError: true,
                  streamingOutput: undefined,
                };
              }
              return m;
            }));
          }
          // Clear completed tool IDs for next request
          completedToolIds.current.clear();
          break;
      }
    };

    agentEvents.on('agent', handler);
    return () => {
      agentEvents.off('agent', handler);
    };
  }, []);

  const addUserMessage = useCallback((content: string) => {
    setMessages(prev => [...prev, { type: 'user', content, id: generateMessageId() }]);
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    setMessages(prev => [...prev, { type: 'system', content, id: generateMessageId() }]);
  }, []);

  const addBashInput = useCallback((command: string) => {
    setMessages(prev => [...prev, { type: 'bash_input', command, id: generateMessageId() }]);
  }, []);

  const addBashOutput = useCallback((stdout: string, stderr: string, isError?: boolean) => {
    setMessages(prev => [...prev, {
      type: 'bash_output',
      stdout,
      stderr,
      isError,
      id: generateMessageId(),
    }]);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    addUserMessage,
    addSystemMessage,
    addBashInput,
    addBashOutput,
    clearMessages,
    isLoading,
    setIsLoading,
    streamingContent,
    toolConfirm,
    setToolConfirm,
  };
}
