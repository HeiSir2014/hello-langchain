/**
 * SkillSelect component
 *
 * Interactive skill selection with keyboard navigation.
 * Groups skills by location (built-in, user, project) and shows active skill.
 */
import * as React from 'react';
import { Box, Text, useInput } from 'ink';
import { getTheme } from '../utils/theme.js';
import type { SkillConfig } from '../../core/skills/types.js';

interface SkillSelectProps {
  skills: SkillConfig[];
  activeSkillName?: string;
  onSelect: (skillName: string) => void;
  onDeactivate: () => void;
  onClose: () => void;
}

export function SkillSelect({
  skills,
  activeSkillName,
  onSelect,
  onDeactivate,
  onClose,
}: SkillSelectProps): React.ReactNode {
  const theme = getTheme();

  // Build options list
  const options = React.useMemo(() => {
    const opts: { type: 'skill' | 'action'; name: string; description: string; location?: string }[] = [];

    // Add deactivate option if there's an active skill
    if (activeSkillName) {
      opts.push({
        type: 'action',
        name: 'off',
        description: `Deactivate current skill (${activeSkillName})`,
      });
    }

    // Group skills by location
    const builtIn = skills.filter(s => s.location === 'built-in');
    const user = skills.filter(s => s.location === 'user');
    const project = skills.filter(s => s.location === 'project');

    // Add skills in order: project > user > built-in
    for (const skill of project) {
      opts.push({
        type: 'skill',
        name: skill.name,
        description: skill.description,
        location: 'project',
      });
    }
    for (const skill of user) {
      opts.push({
        type: 'skill',
        name: skill.name,
        description: skill.description,
        location: 'user',
      });
    }
    for (const skill of builtIn) {
      opts.push({
        type: 'skill',
        name: skill.name,
        description: skill.description,
        location: 'built-in',
      });
    }

    return opts;
  }, [skills, activeSkillName]);

  const [selectedIndex, setSelectedIndex] = React.useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(options.length - 1, prev + 1));
    } else if (key.return) {
      const selected = options[selectedIndex];
      if (selected.type === 'action' && selected.name === 'off') {
        onDeactivate();
      } else {
        onSelect(selected.name);
      }
    } else if (key.escape || input === 'q') {
      onClose();
    }
  });

  // Get location badge color
  const getLocationColor = (location?: string) => {
    switch (location) {
      case 'project':
        return 'cyan';
      case 'user':
        return 'green';
      case 'built-in':
        return 'yellow';
      default:
        return undefined;
    }
  };

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>Select a Skill</Text>
        {activeSkillName && (
          <Text dimColor> (active: {activeSkillName})</Text>
        )}
      </Box>

      {/* Options */}
      <Box flexDirection="column">
        {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          const isActive = option.name === activeSkillName;

          return (
            <Box key={option.name} flexDirection="row">
              <Text color={isSelected ? theme.primary : undefined}>
                {isSelected ? '❯ ' : '  '}
              </Text>
              {option.type === 'action' ? (
                // Action option (deactivate)
                <Text color={isSelected ? 'red' : 'gray'}>
                  ✕ {option.description}
                </Text>
              ) : (
                // Skill option
                <Box flexDirection="row">
                  {isActive && <Text color="green">● </Text>}
                  <Text color={isSelected ? theme.primary : undefined} bold={isActive}>
                    {option.name}
                  </Text>
                  <Text dimColor> - {option.description}</Text>
                  {option.location && (
                    <Text color={getLocationColor(option.location) as any} dimColor>
                      {' '}[{option.location}]
                    </Text>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Help */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓/jk navigate · Enter select · Esc/q close
        </Text>
      </Box>
    </Box>
  );
}
