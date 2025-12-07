/**
 * Spinner component
 */
import { Box, Text } from 'ink';
import React, { useEffect, useRef, useState } from 'react';
import { getTheme } from '../utils/theme.js';
import type { TodoItem } from '../../core/tools/todo.js';

const CHARACTERS =
  process.platform === 'darwin'
    ? ['·', '✢', '✳', '∗', '✻', '✽']
    : ['·', '✢', '*', '∗', '✻', '✽'];

const MESSAGES = [
  'Thinking',
  'Processing',
  'Computing',
  'Generating',
  'Analyzing',
  'Working',
  'Pondering',
  'Crafting',
  'Brewing',
  'Cogitating',
  'Deliberating',
  'Musing',
  'Synthesizing',
];

function sample<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

interface SpinnerProps {
  todos?: TodoItem[];
  showTodos?: boolean;
  isCompacting?: boolean;
  compactingTokens?: number;
}

export function Spinner({ todos = [], showTodos = false, isCompacting = false, compactingTokens }: SpinnerProps): React.ReactNode {
  const theme = getTheme();
  const frames = [...CHARACTERS, ...[...CHARACTERS].reverse()];
  const [frame, setFrame] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const message = useRef(sample(MESSAGES));
  const startTime = useRef(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % frames.length);
    }, 120);

    return () => clearInterval(timer);
  }, [frames.length]);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Get active todos (in_progress first, then pending)
  const activeTodos = todos
    .filter(t => t.status === 'in_progress' || t.status === 'pending')
    .sort((a, b) => {
      if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
      if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
      return 0;
    });

  // Current active task (in_progress one)
  const currentTask = todos.find(t => t.status === 'in_progress');

  // Show max 3 todos when expanded
  const displayTodos = showTodos ? activeTodos.slice(0, 5) : activeTodos.slice(0, 2);
  const hasMoreTodos = activeTodos.length > displayTodos.length;

  // Format token count for display (e.g., 2048 -> "2.0k")
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return String(tokens);
  };

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Main spinner line */}
      <Box flexDirection="row">
        <Box flexWrap="nowrap" height={1} width={2}>
          <Text color={theme.accent}>{frames[frame]}</Text>
        </Box>
        {/* Show compacting status, or activeForm if there's a current task, otherwise show random message */}
        <Text color={theme.accent}>
          {isCompacting ? 'Compacting conversation' : (currentTask ? currentTask.activeForm : message.current)}…{' '}
        </Text>
        <Text color={theme.secondaryText}>
          (<Text bold>esc</Text> to interrupt · {elapsedTime}s
          {isCompacting && compactingTokens && (
            <> · ↓ {formatTokens(compactingTokens)} tokens</>
          )}
          {!isCompacting && todos.length > 0 && (
            <>
              {' · '}
              <Text bold>ctrl+t</Text>
              {showTodos ? ' hide todos' : ' show todos'}
            </>
          )}
          )
        </Text>
      </Box>

      {/* Todo list display */}
      {displayTodos.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          {displayTodos.map((todo, index) => {
            const isActive = todo.status === 'in_progress';
            const isNextPending = !isActive && todo.status === 'pending' &&
              !displayTodos.slice(0, index).some(t => t.status === 'pending');

            let textColor: string;
            let prefix: string;

            if (isActive) {
              textColor = '#10B981'; // Green for active
              prefix = '▸';
            } else if (isNextPending) {
              textColor = '#8B5CF6'; // Purple for next pending
              prefix = '○';
            } else {
              textColor = '#6B7280'; // Gray for others
              prefix = '○';
            }

            return (
              <Box key={`spinner-todo-${index}`} flexDirection="row">
                <Text color={textColor}>{prefix} </Text>
                <Text color={textColor} bold={isActive}>
                  {todo.content}
                </Text>
              </Box>
            );
          })}
          {hasMoreTodos && (
            <Text dimColor>  … +{activeTodos.length - displayTodos.length} more</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

export function SimpleSpinner(): React.ReactNode {
  const frames = [...CHARACTERS, ...[...CHARACTERS].reverse()];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % frames.length);
    }, 120);

    return () => clearInterval(timer);
  }, [frames.length]);

  return (
    <Box flexWrap="nowrap" height={1} width={2}>
      <Text color={getTheme().accent}>{frames[frame]}</Text>
    </Box>
  );
}
