/**
 * Help Component
 *
 * Interactive help system with progressive disclosure.
 * Progressively reveals information to avoid overwhelming users.
 */
import * as React from 'react';
import { Box, Text, useInput } from 'ink';
import { getTheme } from '../utils/theme.js';
import { PressEnterToContinue } from './PressEnterToContinue.js';
import type { Command } from '../commands/index.js';

const PRODUCT_NAME = 'YTerm';
const VERSION = '0.1.0';

export function Help({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}): React.ReactNode {
  const theme = getTheme();

  // Filter out hidden commands from the help display
  const filteredCommands = commands.filter(cmd => !cmd.isHidden);

  // Progressive disclosure state for managing information flow
  const [count, setCount] = React.useState(0);

  // Timer-based progressive disclosure to prevent information overload
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (count < 3) {
        setCount(count + 1);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [count]);

  // Handle Enter key to close help
  useInput((_, key) => {
    if (key.return) onClose();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={theme.accent}>
        {`${PRODUCT_NAME} v${VERSION}`}
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text>
          {PRODUCT_NAME} is a LangGraph-based AI Agent CLI with multi-provider support.
          It can read files, run commands, and edit files with your permission.
        </Text>
      </Box>

      {count >= 1 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Usage Modes:</Text>
          <Text>
            • REPL: <Text bold>YTerm</Text> (interactive session)
          </Text>
          <Text>
            • Non-interactive:{' '}
            <Text bold>YTerm -m model "question"</Text>
          </Text>
          <Box marginTop={1}>
            <Text>
              Run <Text bold>YTerm --help</Text> for all command line options
            </Text>
          </Box>
        </Box>
      )}

      {count >= 2 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Common Tasks:</Text>
          <Text>
            • Ask questions about your codebase{' '}
            <Text color={theme.secondaryText}>
              &gt; How does foo.py work?
            </Text>
          </Text>
          <Text>
            • Edit files{' '}
            <Text color={theme.secondaryText}>
              &gt; Update bar.ts to...
            </Text>
          </Text>
          <Text>
            • Fix errors{' '}
            <Text color={theme.secondaryText}>&gt; npm run build</Text>
          </Text>
          <Text>
            • Run commands{' '}
            <Text color={theme.secondaryText}>&gt; /help</Text>
          </Text>
          <Text>
            • Run bash commands{' '}
            <Text color={theme.secondaryText}>&gt; !ls</Text>
          </Text>
        </Box>
      )}

      {count >= 3 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Built-in Commands:</Text>

          <Box flexDirection="column">
            {filteredCommands.map((cmd, i) => (
              <Box key={i} marginLeft={1}>
                <Text bold>{`/${cmd.name}`}</Text>
                {cmd.aliases && cmd.aliases.length > 0 && (
                  <Text color={theme.secondaryText}>
                    {' '}(/{cmd.aliases.join(', /')})
                  </Text>
                )}
                <Text> - {cmd.description}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Box marginTop={2}>
        <PressEnterToContinue />
      </Box>
    </Box>
  );
}
