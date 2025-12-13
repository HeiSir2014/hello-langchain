import { useState, useEffect, useCallback, useRef } from 'react';
import { agentEvents, AgentEventType } from '../../core/agent/events.js';
import type { MessageItem, ToolConfirmation } from '../types/messages.js';
import { generateMessageId } from '../types/messages.js';

export function useAgentEvents() {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  // Callback to be called when done event fires (for session saving)
  const onDoneCallback = useRef<((interrupted: boolean) => void) | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactingTokens, setCompactingTokens] = useState<number | undefined>(undefined);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolConfirm, setToolConfirm] = useState<ToolConfirmation[] | null>(null);
  // Track tool IDs that have received results (used to avoid race conditions)
  const completedToolIds = useRef<Set<string>>(new Set());
  const [tokenUsage, setTokenUsage] = useState<{ tokenCount: number; contextLimit: number; percentUsed: number } | null>(null);
  // Track when auto-compact completes (to trigger screen clear in REPL)
  const [autoCompactCompleted, setAutoCompactCompleted] = useState(false);

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

        case 'compacting':
          setIsCompacting(true);
          setCompactingTokens(event.tokenCount);
          break;

        case 'token_usage':
          setTokenUsage({
            tokenCount: event.tokenCount,
            contextLimit: event.contextLimit,
            percentUsed: event.percentUsed,
          });
          break;

        case 'auto_compact':
          setIsCompacting(false);
          setCompactingTokens(undefined);
          // 清空所有 UI messages，显示压缩通知和总结
          setMessages([
            {
              type: 'system',
              content: `[Auto-compact] ${event.messagesBefore} messages compressed into summary.`,
              id: generateMessageId(),
            },
            {
              type: 'assistant',
              content: event.summary || 'Conversation history summarized.',
              id: generateMessageId(),
            },
          ]);
          // Signal that auto-compact completed (for screen clearing)
          setAutoCompactCompleted(true);
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
          // Call the done callback (for session saving)
          // Use setTimeout to ensure React state has been updated
          // before we save (response event may have just added a message)
          setTimeout(() => {
            onDoneCallback.current?.(event.interrupted || false);
          }, 50);
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

  // Add bash command and output together (for ! mode - after execution completes)
  const addBashResult = useCallback((command: string, stdout: string, stderr: string, isError?: boolean) => {
    setMessages(prev => [
      ...prev,
      { type: 'bash_input', command, id: generateMessageId() },
      { type: 'bash_output', stdout, stderr, isError, id: generateMessageId() },
    ]);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // Set the onDone callback (for session saving)
  const setOnDone = useCallback((callback: ((interrupted: boolean) => void) | null) => {
    onDoneCallback.current = callback;
  }, []);

  // Restore messages (for session resume)
  const restoreMessages = useCallback((newMessages: MessageItem[]) => {
    setMessages(newMessages);
  }, []);

  // Reset auto-compact flag
  const resetAutoCompactFlag = useCallback(() => {
    setAutoCompactCompleted(false);
  }, []);

  return {
    messages,
    addUserMessage,
    addSystemMessage,
    addBashInput,
    addBashOutput,
    addBashResult,
    clearMessages,
    restoreMessages,
    isLoading,
    setIsLoading,
    isCompacting,
    compactingTokens,
    streamingContent,
    setStreamingContent,
    toolConfirm,
    setToolConfirm,
    setOnDone,
    tokenUsage,
    autoCompactCompleted,
    resetAutoCompactFlag,
  };
}
