/**
 * REPL screen
 *
 * Main interactive interface for the AI terminal assistant.
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
import { getTodos, type TodoItem } from '../../core/tools/todo.js';
import {
  multiTurnChat,
  setAgentModel,
  clearHistory,
  resume,
  abortCurrentRequest,
  getHistory,
  getThreadId,
  setThreadId,
  newThread,
  restoreHistory,
} from '../../core/agent/index.js';
import { getModelConfig } from '../../core/config.js';
import {
  getCommands,
  getCommand,
  hasCommand,
  type Command,
  type CommandContext,
  type ResumeSessionData,
} from '../commands/index.js';
import { PermissionRequest } from '../components/permissions/index.js';
import {
  type PermissionMode,
  getPermissionMode,
  setPermissionMode,
} from '../../core/settings.js';
import { consumeResumeData } from '../commands/resumeState.js';
import { saveSession } from '../../core/session/index.js';
import { log } from '../../logger.js';

interface REPLProps {
  initialModel: string;
  initialPrompt?: string;
}

/**
 * Streaming indicator component
 * Shows cursor and elapsed time during LLM streaming output
 */
function StreamingIndicator({ isLoading }: { isLoading: boolean }): React.ReactNode {
  const theme = getTheme();
  const [elapsedTime, setElapsedTime] = useState(0);
  const startTimeRef = React.useRef(Date.now());

  // Reset timer when loading starts
  useEffect(() => {
    if (isLoading) {
      startTimeRef.current = Date.now();
      setElapsedTime(0);
    }
  }, [isLoading]);

  // Update elapsed time every second
  useEffect(() => {
    if (!isLoading) return;

    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [isLoading]);

  if (!isLoading) {
    // Just show cursor when not loading (output complete)
    return <Text dimColor>▌</Text>;
  }

  return (
    <Box flexDirection="row">
      <Text color={theme.accent}>▌</Text>
      <Text dimColor> streaming… ({elapsedTime}s · </Text>
      <Text dimColor bold>esc</Text>
      <Text dimColor> to interrupt)</Text>
    </Box>
  );
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

  // Todo display state (for Spinner integration)
  const [showTodos, setShowTodos] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>(getTodos());

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
  } = useAgentEvents();

  // Session state
  const [sessionId, setSessionId] = useState<string>(() => `session_${Date.now()}`);
  const sessionInitialized = useRef(false);

  // Initialize model
  useEffect(() => {
    setAgentModel(initialModel);
    setCurrentModel(initialModel);
  }, [initialModel]);

  // Track restored LangGraph messages (to merge with new ones on save)
  const restoredLangGraphMessages = useRef<any[]>([]);

  // Handle session resume on mount (for --continue and --resume CLI flags)
  useEffect(() => {
    if (sessionInitialized.current) return;
    sessionInitialized.current = true;

    const resumeData = consumeResumeData();
    if (resumeData) {
      // Restore session state
      setSessionId(resumeData.sessionId);
      setThreadId(resumeData.threadId);
      setCurrentModel(resumeData.model);
      setAgentModel(resumeData.model);
      restoreMessages(resumeData.uiMessages);

      // Save restored LangGraph messages for merging on save
      if (resumeData.langGraphMessages && resumeData.langGraphMessages.length > 0) {
        restoredLangGraphMessages.current = resumeData.langGraphMessages;

        // Also inject into agent state for context
        restoreHistory(resumeData.langGraphMessages).catch(error => {
          log.error('Failed to restore LangGraph history on mount', { error: error.message });
        });
      }

      log.info('Session resumed on mount', {
        sessionId: resumeData.sessionId,
        threadId: resumeData.threadId,
        model: resumeData.model,
        messageCount: resumeData.uiMessages.length,
        langGraphMessages: resumeData.langGraphMessages?.length || 0,
      });

      addSystemMessage(`Session resumed (${resumeData.uiMessages.length} messages)`);
    }
  }, [restoreMessages, addSystemMessage]);

  // Use ref to always get latest messages for session saving
  const messagesRef = useRef(messages);
  const sessionIdRef = useRef(sessionId);
  const currentModelRef = useRef(currentModel);

  // Keep refs in sync with state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    currentModelRef.current = currentModel;
  }, [currentModel]);

  // Set up session saving on done event
  useEffect(() => {
    const handleDone = async (_interrupted: boolean) => {
      // Use refs to get the latest values
      const currentMessages = messagesRef.current;
      const currentSessionId = sessionIdRef.current;
      const currentModelValue = currentModelRef.current;

      // Don't save if no messages
      if (currentMessages.length === 0) return;

      // Filter out ephemeral system messages that shouldn't be persisted
      // These are temporary UI hints that don't contribute to conversation context
      const EPHEMERAL_PATTERNS = [
        /^Session resumed/i,
        /^Resuming session/i,
        /^📝 Message queued:/,
        /^ℹ️? ?(Session|Resuming)/i,
      ];
      const filteredMessages = currentMessages.filter(m => {
        if (m.type !== 'system') return true;
        const content = (m as { content: string }).content;
        return !EPHEMERAL_PATTERNS.some(pattern => pattern.test(content));
      });

      try {
        // Get current LangGraph messages from agent state
        const currentLangGraphMessages = await getHistory();
        const threadId = getThreadId();

        // Merge restored messages with current messages (dedupe by ID)
        // This ensures:
        // 1. We don't lose history when the app restarts
        // 2. We don't lose history when LangGraph auto-summarizes
        // 3. We don't duplicate messages
        const existingIds = new Set(
          restoredLangGraphMessages.current
            .map((m: any) => m.id)
            .filter(Boolean)
        );

        // Only add new messages that don't already exist
        const newMessages = currentLangGraphMessages.filter(
          (m: any) => !m.id || !existingIds.has(m.id)
        );

        const allLangGraphMessages = [
          ...restoredLangGraphMessages.current,
          ...newMessages,
        ];

        // Update the ref for next save
        restoredLangGraphMessages.current = allLangGraphMessages;

        // Save or update session (using filtered messages)
        saveSession(
          currentSessionId,
          threadId,
          currentModelValue,
          filteredMessages,
          allLangGraphMessages,
        );
      } catch (error: any) {
        log.error('Failed to save session', { error: error.message });
      }
    };

    setOnDone(handleDone);
    return () => setOnDone(null);
  }, [setOnDone]);

  // Update todos when messages change (todo might have been updated by agent)
  useEffect(() => {
    setTodos(getTodos());
  }, [messages]);

  // Handle auto-compact completion - clear screen by incrementing forkNumber
  useEffect(() => {
    if (autoCompactCompleted) {
      // Increment fork number to force complete re-render (clear screen)
      setForkNumber(prev => prev + 1);
      // Reset the flag
      resetAutoCompactFlag();
    }
  }, [autoCompactCompleted, resetAutoCompactFlag]);

  // Handle initial prompt
  useEffect(() => {
    if (initialPrompt) {
      handleSubmit(initialPrompt);
    }
  }, [initialPrompt]);

  // AbortController for bash commands
  const bashAbortControllerRef = useRef<AbortController | null>(null);


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

      // Don't add to messages yet - show in dynamic area during execution
      setIsLoading(true);
      setStreamingContent(`\`${command}\`\n`);

      // Create new AbortController for this command
      bashAbortControllerRef.current = new AbortController();

      try {
        const result = await executeBashCommand(command, {
          abortSignal: bashAbortControllerRef.current.signal,
          onOutput: (stdout, stderr) => {
            // Format output for streaming display (show last N lines)
            const MAX_LINES = 10;
            const output = stdout + stderr;
            const lines = output.split('\n').filter(l => l);
            const displayLines = lines.slice(-MAX_LINES);
            const hasMore = lines.length > MAX_LINES;
            const prefix = hasMore ? `... (${lines.length - MAX_LINES} more lines)\n` : '';
            setStreamingContent(`\`${command}\`\n${prefix}${displayLines.join('\n')}`);
          },
        });
        // Clear streaming output and add final result to Static area
        setStreamingContent('');
        addBashResult(command, result.stdout, result.stderr, result.isError);
      } catch (error: any) {
        setStreamingContent('');
        addBashResult(command, '', error.message, true);
      } finally {
        bashAbortControllerRef.current = null;
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
  }, [isLoading, addUserMessage, addSystemMessage, addBashResult, setIsLoading]);

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

  // Resume session handler (called by /resume command)
  const resumeSession = useCallback(async (data: ResumeSessionData) => {
    // Update session state
    setSessionId(data.sessionId);
    setThreadId(data.threadId);
    setCurrentModel(data.model);
    setAgentModel(data.model);

    // Restore UI messages
    restoreMessages(data.uiMessages);

    // Save restored LangGraph messages for merging on save
    if (data.langGraphMessages && data.langGraphMessages.length > 0) {
      restoredLangGraphMessages.current = data.langGraphMessages;

      // Also inject into agent state for context
      try {
        await restoreHistory(data.langGraphMessages);
      } catch (error: any) {
        log.error('Failed to restore LangGraph history', { error: error.message });
      }
    }

    // Increment fork number to force re-render of Static items
    setForkNumber(prev => prev + 1);

    log.info('Session resumed via /resume command', {
      sessionId: data.sessionId,
      threadId: data.threadId,
      model: data.model,
      messageCount: data.uiMessages.length,
      langGraphMessages: data.langGraphMessages?.length || 0,
    });
  }, [restoreMessages]);

  // Build command context
  const getCommandContext = useCallback((): CommandContext => ({
    commands,
    currentModel,
    clearMessages,
    clearHistory,
    addSystemMessage,
    addUserMessage,
    setCurrentModel,
    setAgentModel,
    setForkNumber,
    setIsLoading,
    resumeSession,
  }), [commands, currentModel, clearMessages, addSystemMessage, addUserMessage, setIsLoading, resumeSession]);

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
            argsString,
            (result?: string) => {
              setCommandJSX(null);
              if (result) {
                addSystemMessage(result);
              }
            },
            context,
          );
          setCommandJSX(jsx);
        } else if (command.type === 'prompt') {
          // Prompt command: get prompt and send to agent
          const prompts = await command.getPromptForCommand(argsString, context);
          for (const prompt of prompts) {
            await handleSubmit(prompt.content);
          }
        } else if (command.type === 'agent') {
          // Agent command: run specialized sub-agent
          setIsLoading(true);
          try {
            const result = await command.runAgent(argsString, context);
            if (!result.success) {
              addSystemMessage(`Command failed: ${result.message}`);
            }
          } finally {
            setIsLoading(false);
          }
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
    // Ctrl+T toggles todo display in spinner
    if (key.ctrl && (input === 't' || input === 'T')) {
      setShowTodos(prev => !prev);
      // Refresh todos when toggling
      setTodos(getTodos());
      return;
    }

    // Allow Esc to interrupt when loading OR when a tool is executing
    // But not when permission confirmation is showing (toolConfirm handles its own Esc)
    if (key.escape && (isLoading || hasExecutingTool) && !hasInterrupted && !toolConfirm) {
      // Check if we're running a bash command (! prefix)
      if (bashAbortControllerRef.current) {
        bashAbortControllerRef.current.abort();
        setHasInterrupted(true);
        setStreamingContent('');
        // No need to add system message - the bash output will show interrupted status
        return;
      }

      // Otherwise interrupt the agent
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


  // Get model info
  const modelInfo = useMemo(() => {
    const config = getModelConfig(currentModel);
    if (!config) return null;

    const info = {
      name: config.model || currentModel,
      provider: config.provider || 'unknown',
      contextLength: tokenUsage?.contextLimit || config.contextWindow || 128000,
      currentTokens: tokenUsage?.tokenCount || 0,
    };

    // Log model info display
    const percent = Math.round((info.currentTokens / info.contextLength) * 100);
    log.debug('Model info display', {
      model: info.name,
      provider: info.provider,
      currentTokens: info.currentTokens,
      contextLength: info.contextLength,
      percentUsed: percent,
      display: `${Math.round(info.currentTokens / 1000)}k / ${Math.round(info.contextLength / 1000)}k ${percent}%`
    });

    return info;
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
              {/* Show streaming indicator with cursor */}
              <StreamingIndicator isLoading={isLoading} />
            </Box>
          </Box>
        )}

        {/* Loading animation - shown when no streaming content */}
        {isLoading && !streamingContent && !toolConfirm && (
          <Spinner todos={todos} showTodos={showTodos} isCompacting={isCompacting} compactingTokens={compactingTokens} />
        )}

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

