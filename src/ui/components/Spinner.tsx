/**
 * Spinner component
 */
import { Box, Text } from 'ink';
import React, { useEffect, useRef, useState } from 'react';
import { getTheme } from '../utils/theme.js';

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

export function Spinner(): React.ReactNode {
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

  return (
    <Box flexDirection="row" marginTop={1}>
      <Box flexWrap="nowrap" height={1} width={2}>
        <Text color={getTheme().accent}>{frames[frame]}</Text>
      </Box>
      <Text color={getTheme().accent}>{message.current}… </Text>
      <Text color={getTheme().secondaryText}>
        ({elapsedTime}s · <Text bold>esc</Text> to interrupt)
      </Text>
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
