/**
 * SessionSelect component
 *
 * Interactive session selection for resuming previous conversations.
 * Shows session list with metadata and allows keyboard navigation.
 */
import * as React from "react";
import { Box, Text, useInput } from "ink";
import { getTheme } from "../utils/theme.js";
import type { SessionMetadata } from "../../core/session/index.js";

interface SessionSelectProps {
  sessions: SessionMetadata[];
  onSelect: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onClose: () => void;
}

/**
 * Format relative time (e.g., "2 hours ago", "yesterday")
 */
function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  // Format as date
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

export function SessionSelect({
  sessions,
  onSelect,
  onDelete,
  onClose,
}: SessionSelectProps): React.ReactNode {
  const theme = getTheme();
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  // Empty state
  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text color={theme.secondaryText}>No saved sessions found.</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to close</Text>
        </Box>
      </Box>
    );
  }

  useInput((input, key) => {
    // Handle delete confirmation
    if (confirmDelete) {
      if (input === "y" || input === "Y") {
        onDelete?.(confirmDelete);
        setConfirmDelete(null);
        // Adjust selection if needed
        if (selectedIndex >= sessions.length - 1) {
          setSelectedIndex(Math.max(0, sessions.length - 2));
        }
      } else {
        setConfirmDelete(null);
      }
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((prev) => Math.min(sessions.length - 1, prev + 1));
    } else if (key.return) {
      const selected = sessions[selectedIndex];
      if (selected) {
        onSelect(selected.sessionId);
      }
    } else if ((input === "d" || input === "D") && onDelete) {
      const selected = sessions[selectedIndex];
      if (selected) {
        setConfirmDelete(selected.sessionId);
      }
    } else if (key.escape || input === "q") {
      onClose();
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>
          Resume Session
        </Text>
        <Text dimColor> ({sessions.length} sessions)</Text>
      </Box>

      {/* Delete confirmation */}
      {confirmDelete && (
        <Box marginBottom={1}>
          <Text color="red">Delete this session? </Text>
          <Text color="yellow" bold>
            y
          </Text>
          <Text color="gray">/</Text>
          <Text color="green" bold>
            n
          </Text>
        </Box>
      )}

      {/* Session list */}
      <Box flexDirection="column">
        {sessions.map((session, index) => {
          const isSelected = index === selectedIndex;
          const isBeingDeleted = session.sessionId === confirmDelete;
          const textColor = isBeingDeleted ? "gray" : (isSelected ? theme.primary : undefined);

          return (
            <Box
              key={session.sessionId}
              flexDirection="row"
            >
              {/* Selection indicator */}
              <Text color={textColor}>
                {isSelected ? "❯ " : "  "}
              </Text>

              {/* Session info */}
              <Box flexDirection="column" width="100%">
                <Box flexDirection="row">
                  {/* Time */}
                  <Text
                    color={isSelected ? theme.primary : "gray"}
                    bold={isSelected}
                  >
                    {formatRelativeTime(session.updatedAt)}
                  </Text>

                  {/* Model */}
                  <Text dimColor> · </Text>
                  <Text color={isSelected ? "cyan" : "gray"}>
                    {session.model}
                  </Text>

                  {/* Message count */}
                  <Text dimColor> · </Text>
                  <Text dimColor>{session.messageCount} msgs</Text>
                </Box>

                {/* First prompt preview */}
                <Text
                  dimColor={!isSelected}
                  color={isSelected ? undefined : "gray"}
                >
                  {truncate(session.firstPrompt || "(empty)", 60)}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Help */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓/jk navigate · Enter select · d delete · Esc close
        </Text>
      </Box>
    </Box>
  );
}
