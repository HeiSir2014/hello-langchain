/**
 * Logo component with rainbow ASCII art
 */
import { Box, Text } from 'ink';
import React, { useState, useEffect } from 'react';
import { getTheme } from '../utils/theme.js';
import { getCwd } from '../utils/terminal.js';
import { getUseProvider, getModelConfig } from '../../core/config.js';

export const MIN_LOGO_WIDTH = 60;

// ASCII art for YTerm (ANSI Shadow style)
const ASCII_LOGO = [
  '██╗   ██╗████████╗███████╗██████╗ ███╗   ███╗',
  '╚██╗ ██╔╝╚══██╔══╝██╔════╝██╔══██╗████╗ ████║',
  ' ╚████╔╝    ██║   █████╗  ██████╔╝██╔████╔██║',
  '  ╚██╔╝     ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║',
  '   ██║      ██║   ███████╗██║  ██║██║ ╚═╝ ██║',
  '   ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝',
];

// Gradient colors (left to right) - blue to purple smooth transition
const GRADIENT_COLORS = [
  '#38BDF8', // Sky Blue
  '#60A5FA', // Light Blue
  '#818CF8', // Indigo
  '#A78BFA', // Purple
  '#C084FC', // Violet
  '#E879F9', // Fuchsia
];

// Logo width in characters
const LOGO_WIDTH = ASCII_LOGO[0]?.length || 45;

// Number of color segments across the logo
const SEGMENT_COUNT = GRADIENT_COLORS.length;

interface LogoProps {
  model: string;
  provider?: string;
}

// Get color for a position (0 to 1) with smooth gradient
function getColorAtPosition(position: number, offset: number): string {
  // Shift position based on animation offset
  const shiftedPos = (position + offset) % 1;
  const colorIndex = Math.floor(shiftedPos * SEGMENT_COUNT);
  return GRADIENT_COLORS[colorIndex % GRADIENT_COLORS.length]!;
}

// Render a line with smooth left-to-right gradient
function GradientLine({ text, offset }: { text: string; offset: number }): React.ReactNode {
  const chars = text.split('');
  return (
    <Text bold>
      {chars.map((char, i) => {
        if (char === ' ') {
          return <Text key={i}>{char}</Text>;
        }
        // Calculate position as percentage of logo width
        const position = i / LOGO_WIDTH;
        const color = getColorAtPosition(position, offset);
        return (
          <Text key={i} color={color}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}

// Animated rainbow logo with smooth color shift
function AnimatedLogo(): React.ReactNode {
  const [colorOffset, setColorOffset] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      // Shift by small increment for smooth animation
      setColorOffset(prev => (prev + 0.05) % 1);
    }, 150);

    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column">
      {ASCII_LOGO.map((line, lineIndex) => (
        <GradientLine
          key={lineIndex}
          text={line}
          offset={colorOffset}
        />
      ))}
    </Box>
  );
}

export function Logo({ model, provider: propProvider }: LogoProps): React.ReactNode {
  const theme = getTheme();
  const cwd = getCwd();

  // 优先使用传入的 provider，否则从模型配置获取，最后从全局设置获取
  const modelConfig = getModelConfig(model);
  const provider = propProvider || modelConfig?.provider || getUseProvider();

  const width = Math.max(MIN_LOGO_WIDTH, cwd.length + 12);

  return (
    <Box flexDirection="column">
      <Box
        borderColor={theme.accent}
        borderStyle="round"
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        marginRight={2}
        width={width}
      >
        {/* Animated Rainbow ASCII Logo */}
        <AnimatedLogo />

        {/* Subtitle */}
        <Box marginTop={1}>
          <Text color={theme.secondaryText}>
            AI Terminal Assistant · research preview
          </Text>
        </Box>

        {/* Info */}
        <Box paddingLeft={1} flexDirection="column" marginTop={1}>
          <Text color={theme.secondaryText} italic>
            /help for help
          </Text>
          <Text color={theme.secondaryText}>model: {provider}/{model}</Text>
          <Text color={theme.secondaryText}>cwd: {cwd}</Text>
        </Box>
      </Box>
    </Box>
  );
}
