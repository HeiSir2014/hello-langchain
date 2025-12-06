/**
 * REPL screen
 *
 * Main interactive interface for the AI terminal assistant.
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, Static, useApp, Text, Newline, useInput } from 'ink';
import { Logo } from '../components/Logo.js';
import { Spinner } from '../components/Spinner.js';
import { PromptInput } from '../components/PromptInput.js';
import { Message } from '../components/Message.js';
import { useAgentEvents } from '../hooks/useAgentEvents.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { getTheme, BLACK_CIRCLE } from '../utils/theme.js';
import { applyMarkdown } from '../utils/markdown.js';
import { executeBashCommand } from '../utils/bash.js';
import type { MessageItem } from '../types/messages.js';
import {
  multiTurnChat,
  setAgentModel,
  clearHistory,
  resume,
  abortCurrentRequest,
} from '../../core/agent/index.js';
import { getModelConfig } from '../../core/config.js';
import {
  getCommands,
  getCommand,
  hasCommand,
  type Command,
  type CommandContext,
} from '../commands/index.js';
import { PermissionRequest } from '../components/permissions/index.js';
import {
  type PermissionMode,
  getPermissionMode,
  setPermissionMode,
} from '../../core/settings.js';

interface REPLProps {
  initialModel: string;
  initialPrompt?: string;
}

export function REPL({ initialModel, initialPrompt }: REPLProps): React.ReactNode {
  const { exit } = useApp();
  const theme = getTheme();
  const { columns } = useTerminalSize();
  const [inputValue, setInputValue] = useState('');
  const [currentModel, setCurrentModel] = useState(initialModel);
  const [forkNumber, setForkNumber] = useState(0);
  const [commands] = useState<Command[]>(getCommands());
  const [commandJSX, setCommandJSX] = useState<React.ReactNode | null>(null);
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>(getPermissionMode());
  const [pendingInput, setPendingInput] = useState<string | null>(null);

  // Handle permission mode change
  const handlePermissionModeChange = useCallback((mode: PermissionMode) => {
    setPermissionModeState(mode);
    setPermissionMode(mode);
  }, []);

  // Use event subscription
  const {
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
  } = useAgentEvents();

  // Initialize model
  useEffect(() => {
    setAgentModel(initialModel);
    setCurrentModel(initialModel);
  }, [initialModel]);

  // Handle initial prompt
  useEffect(() => {
    if (initialPrompt) {
      handleSubmit(initialPrompt);
    }
  }, [initialPrompt]);

  // Handle user input
  const handleSubmit = useCallback(async (input: string) => {
    if (!input.trim()) return;

    // If loading, queue the input as pending (don't interrupt)
    if (isLoading) {
      setPendingInput(input);
      addSystemMessage(`📝 Message queued: "${input.slice(0, 50)}${input.length > 50 ? '...' : ''}"`);
      return;
    }

    // Handle bash mode (input starts with !)
    if (input.startsWith('!')) {
      const command = input.slice(1).trim();
      if (!command) return;

      addBashInput(command);
      setIsLoading(true);

      try {
        const result = await executeBashCommand(command);
        addBashOutput(result.stdout, result.stderr, result.isError);
      } catch (error: any) {
        addBashOutput('', error.message, true);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Handle slash commands
    if (input.startsWith('/')) {
      await handleCommand(input);
      return;
    }

    // Add user message to UI
    addUserMessage(input);

    try {
      // Call LangGraph Agent
      await multiTurnChat(input);
      // Response will be handled by events
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addSystemMessage(`Error: ${errorMessage}`);
    }
  }, [isLoading, addUserMessage, addSystemMessage, addBashInput, addBashOutput, setIsLoading]);

  // Process pending input when loading completes
  useEffect(() => {
    if (!isLoading && pendingInput) {
      const input = pendingInput;
      setPendingInput(null);
      // Small delay to ensure UI updates first
      setTimeout(() => {
        handleSubmit(input);
      }, 100);
    }
  }, [isLoading, pendingInput, handleSubmit]);

  // Build command context
  const getCommandContext = useCallback((): CommandContext => ({
    commands,
    currentModel,
    clearMessages,
    clearHistory,
    addSystemMessage,
    setCurrentModel,
    setAgentModel,
    setForkNumber,
  }), [commands, currentModel, clearMessages, addSystemMessage]);

  // Handle commands
  const handleCommand = async (cmd: string) => {
    const [commandName, ...args] = cmd.slice(1).split(' ');
    const argsString = args.join(' ');

    // Handle exit command specially
    if (commandName.toLowerCase() === 'exit' || commandName.toLowerCase() === 'q') {
      exit();
      return;
    }

    // Find and execute command
    if (hasCommand(commandName, commands)) {
      const command = getCommand(commandName, commands);
      if (!command) return;

      const context = getCommandContext();

      try {
        if (command.type === 'local') {
          await command.call(argsString, context);
        } else if (command.type === 'local-jsx') {
          const jsx = await command.call(
            (result?: string) => {
              setCommandJSX(null);
              if (result) {
                addSystemMessage(result);
              }
            },
            context,
          );
          setCommandJSX(jsx);
        }
      } catch (error: any) {
        addSystemMessage(`Command error: ${error.message}`);
      }
    } else {
      addSystemMessage(`Unknown command: ${commandName}. Type /help for help.`);
    }
  };

  // Handle escape key to interrupt - only trigger once per loading session
  const [hasInterrupted, setHasInterrupted] = useState(false);

  // Check if any tool is currently executing (has tool_use without result)
  const hasExecutingTool = useMemo(() => {
    return messages.some(m => m.type === 'tool_use' && m.result === undefined);
  }, [messages]);

  // Reset interrupt flag when loading starts or tool execution starts
  useEffect(() => {
    if (isLoading || hasExecutingTool) {
      setHasInterrupted(false);
    }
  }, [isLoading, hasExecutingTool]);

  useInput((input, key) => {
    // Allow Esc to interrupt when loading OR when a tool is executing
    // But not when permission confirmation is showing (toolConfirm handles its own Esc)
    if (key.escape && (isLoading || hasExecutingTool) && !hasInterrupted && !toolConfirm) {
      const aborted = abortCurrentRequest();
      if (aborted) {
        setHasInterrupted(true);
        addSystemMessage('Interrupted by user');
      }
    }
  });

  // Permission confirmation handler
  const handleApprove = useCallback((response?: any) => {
    setToolConfirm(null);
    // response already contains { approved: true, savePermission?: ... }
    resume(response || { approved: true });
  }, [setToolConfirm]);

  const handleReject = useCallback(() => {
    setToolConfirm(null);
    resume({ approved: false });
  }, [setToolConfirm]);

  // Determine if a message should be rendered statically
  // Static messages won't change, transient messages (in-progress tools) can update
  const shouldRenderStatically = useCallback((msg: MessageItem): boolean => {
    if (msg.type === 'tool_use') {
      // Tool use without result is still in progress
      return msg.result !== undefined;
    }
    return true;
  }, []);

  // Token usage - estimate from UI messages + base system prompt tokens
  const tokenUsage = useMemo(() => {
    // Base tokens for system prompt (approximately)
    const SYSTEM_PROMPT_TOKENS = 2500;

    let total = SYSTEM_PROMPT_TOKENS;

    for (const msg of messages) {
      const overhead = 4;
      switch (msg.type) {
        case 'user':
        case 'assistant':
        case 'system':
        case 'error':
          total += overhead + estimateTokens(msg.content || '');
          break;
        case 'tool_use':
          total += overhead + estimateTokens(msg.name || '') + estimateTokens(JSON.stringify(msg.args || {})) + 10;
          if (msg.result) {
            total += overhead + estimateTokens(msg.result);
          }
          break;
        case 'bash_input':
          total += overhead + estimateTokens(msg.command || '');
          break;
        case 'bash_output':
          total += overhead + estimateTokens((msg.stdout || '') + (msg.stderr || ''));
          break;
      }
    }
    return total;
  }, [messages]);

  // Simple token estimation
  function estimateTokens(text: string): number {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5) + Math.ceil(otherChars / 4);
  }

  // Get model info
  const modelInfo = useMemo(() => {
    const config = getModelConfig(currentModel);
    if (!config) return null;

    return {
      name: config.model || currentModel,
      provider: config.provider || 'unknown',
      contextLength: config.contextWindow || 128000,
      currentTokens: tokenUsage,
    };
  }, [currentModel, tokenUsage]);

  // Build messagesJSX
  const messagesJSX = useMemo(() => {
    return [
      // Logo is first static item
      {
        type: 'static' as const,
        jsx: (
          <Box flexDirection="column" key={`logo${forkNumber}`}>
            <Logo model={currentModel} provider={modelInfo?.provider} />
          </Box>
        ),
      },
      // Then messages - determine static vs transient
      ...messages.map((msg, index) => ({
        type: shouldRenderStatically(msg) ? 'static' as const : 'transient' as const,
        jsx: (
          <Box key={msg.id || `msg_${index}`} width="100%">
            <Message message={msg} />
          </Box>
        ),
      })),
    ];
  }, [forkNumber, currentModel, messages, shouldRenderStatically, modelInfo]);

  return (
    <React.Fragment>
      {/* Static messages (Logo + completed messages) */}
      <React.Fragment key={`static-messages-${forkNumber}`}>
        <Static
          items={messagesJSX.filter(_ => _.type === 'static')}
          children={(item: any) => item.jsx}
        />
      </React.Fragment>

      {/* Transient messages (in-progress tool calls) - rendered outside Static so they can update */}
      {messagesJSX.filter(_ => _.type === 'transient').map(_ => _.jsx)}

      {/* Dynamic content box */}
      <Box flexDirection="column" width="100%">
        {/* Streaming output */}
        {streamingContent && (
          <Box marginTop={1} flexDirection="row" width="100%">
            <Box minWidth={2}>
              <Text color={theme.text}>{BLACK_CIRCLE}</Text>
            </Box>
            <Box flexDirection="column" width={columns - 6}>
              <Text>{applyMarkdown(streamingContent)}</Text>
              <Text dimColor>▌</Text>
            </Box>
          </Box>
        )}

        {/* Loading animation - shown alongside input, not instead of it */}
        {isLoading && !streamingContent && !toolConfirm && <Spinner />}

        {/* Permission confirmation */}
        {toolConfirm && toolConfirm.length > 0 && (
          <PermissionRequest
            tools={toolConfirm}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        )}

        {/* Command JSX output (e.g., Help component) */}
        {commandJSX}

        {/* Input box - always visible, dimmed when loading */}
        {/* User input during loading will be queued as pending */}
        {!toolConfirm && !commandJSX && (
          <PromptInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            isDisabled={false}
            isLoading={isLoading}
            modelInfo={modelInfo}
            permissionMode={permissionMode}
            onPermissionModeChange={handlePermissionModeChange}
            pendingMessage={pendingInput}
          />
        )}
      </Box>

      {/* Fix occasional rendering artifact */}
      <Newline />
    </React.Fragment>
  );
}

