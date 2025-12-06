/**
 * BashOutputMessage component BashToolResultMessage
 */
import { Box, Text } from 'ink';
import React from 'react';
import { getTheme } from '../../utils/theme.js';
import chalk from 'chalk';

const MAX_RENDERED_LINES = 20;

interface BashOutputMessageProps {
  stdout: string;
  stderr: string;
  isError?: boolean;
  verbose?: boolean;
}

function renderTruncatedContent(content: string, totalLines: number): string {
  const allLines = content.split('\n');
  if (allLines.length <= MAX_RENDERED_LINES) {
    return allLines.join('\n');
  }

  // Show last lines of output by default
  const lastLines = allLines.slice(-MAX_RENDERED_LINES);
  return [
    chalk.grey(
      `Showing last ${MAX_RENDERED_LINES} lines of ${totalLines} total lines`,
    ),
    ...lastLines,
  ].join('\n');
}

function OutputLine({
  content,
  lines,
  verbose,
  isError,
}: {
  content: string;
  lines: number;
  verbose: boolean;
  isError?: boolean;
}): React.ReactNode {
  const theme = getTheme();

  return (
    <Box justifyContent="space-between" width="100%">
      <Box flexDirection="row">
        <Text>&nbsp;&nbsp;⎿ &nbsp;</Text>
        <Box flexDirection="column">
          <Text color={isError ? theme.error : undefined}>
            {verbose
              ? content.trim()
              : renderTruncatedContent(content.trim(), lines)}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export function BashOutputMessage({
  stdout,
  stderr,
  isError,
  verbose = false,
}: BashOutputMessageProps): React.ReactNode {
  const theme = getTheme();
  const stdoutLines = stdout ? stdout.split('\n').length : 0;
  const stderrLines = stderr ? stderr.split('\n').length : 0;

  return (
    <Box flexDirection="column">
      {stdout && stdout.trim() !== '' && (
        <OutputLine content={stdout} lines={stdoutLines} verbose={verbose} />
      )}
      {stderr && stderr.trim() !== '' && (
        <OutputLine
          content={stderr}
          lines={stderrLines}
          verbose={verbose}
          isError
        />
      )}
      {(!stdout || stdout.trim() === '') && (!stderr || stderr.trim() === '') && (
        <Box flexDirection="row">
          <Text>&nbsp;&nbsp;⎿ &nbsp;</Text>
          <Text color={theme.secondaryText}>(No output)</Text>
        </Box>
      )}
    </Box>
  );
}
