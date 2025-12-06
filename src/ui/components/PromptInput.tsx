/**
 * PromptInput component
 *
 * Features:
 * - Border styled input box (round style)
 * - Mode indicator (> for prompt, ! for bash)
 * - Slash command suggestions with ◆ indicator
 * - Double ESC to clear input
 * - Ctrl+C to clear input, double Ctrl+C to exit
 * - Ctrl+G to open external editor
 * - Shift+Enter for newline
 * - Hints below input
 * - Model info display
 */
import { Box, Text, useInput, useApp } from 'ink';
import React, { useState, memo, useMemo, useCallback } from 'react';
import { getTheme } from '../utils/theme.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useDoublePress } from '../hooks/useDoublePress.js';
import { launchExternalEditor } from '../utils/externalEditor.js';
import { getImageFromClipboard, CLIPBOARD_ERROR_MESSAGE, getImageInfo } from '../utils/imagePaste.js';
import { type PermissionMode, MODE_CONFIGS } from '../../core/settings.js';

type InputMode = 'prompt' | 'bash';

// Simple command suggestion
interface CommandSuggestion {
  name: string;
  description: string;
}

const BUILT_IN_COMMANDS: CommandSuggestion[] = [
  { name: 'help', description: 'Show help and available commands' },
  { name: 'clear', description: 'Clear conversation history' },
  { name: 'model', description: 'Switch model or show current model' },
  { name: 'compact', description: 'Clear with summary' },
  { name: 'exit', description: 'Exit the application' },
];

// Model info interface
interface ModelInfo {
  name: string;
  provider: string;
  contextLength: number;
  currentTokens: number;
}

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  isDisabled?: boolean;
  isLoading?: boolean;
  modelInfo?: ModelInfo | null;
  onImagePaste?: (base64Image: string) => void;
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  pendingMessage?: string | null; // Message queued during loading
}

// Paste detection state type
interface PasteState {
  chunks: string[];
  timeoutId: ReturnType<typeof setTimeout> | null;
}

function PromptInputComponent({
  value,
  onChange,
  onSubmit,
  placeholder,
  isDisabled = false,
  isLoading = false,
  modelInfo,
  onImagePaste,
  permissionMode = 'default',
  onPermissionModeChange,
  pendingMessage,
}: PromptInputProps): React.ReactNode {
  const { exit } = useApp();
  const theme = getTheme();
  const { columns } = useTerminalSize();
  const [mode, setMode] = useState<InputMode>('prompt');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null); // Temporary status messages
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [pastedImage, setPastedImage] = useState<string | null>(null);

  // Paste detection state (for handling large pastes that arrive in chunks)
  const [pasteState, setPasteState] = useState<PasteState>({
    chunks: [],
    timeoutId: null,
  });

  // Handle Ctrl+V for image paste
  const handleImagePaste = useCallback(() => {
    const base64Image = getImageFromClipboard();
    if (base64Image) {
      const info = getImageInfo(base64Image);
      if (info.isValid) {
        setPastedImage(base64Image);
        onImagePaste?.(base64Image);
        // Insert placeholder text
        const placeholder = '[Image pasted]';
        const newValue = value.slice(0, cursorPosition) + placeholder + value.slice(cursorPosition);
        onChange(newValue);
        setCursorPosition(cursorPosition + placeholder.length);
        setStatusMessage(`Image pasted (${info.sizeKB}KB)`);
        setTimeout(() => setStatusMessage(null), 3000);
      } else {
        setStatusMessage('Invalid image format');
        setTimeout(() => setStatusMessage(null), 3000);
      }
    } else {
      if (process.platform === 'darwin') {
        setStatusMessage(CLIPBOARD_ERROR_MESSAGE);
        setTimeout(() => setStatusMessage(null), 4000);
      }
    }
  }, [value, cursorPosition, onChange, onImagePaste]);

  // Calculate command suggestions
  const commandSuggestions = useMemo(() => {
    if (!value.startsWith('/')) return [];
    const query = value.slice(1).toLowerCase();
    return BUILT_IN_COMMANDS.filter(cmd =>
      cmd.name.toLowerCase().startsWith(query)
    );
  }, [value]);

  const showSuggestions = mode === 'prompt' && commandSuggestions.length > 0;

  // Double Ctrl+C handler - first clears input, second exits
  const handleCtrlC = useDoublePress(
    (pending) => {
      if (pending) {
        setStatusMessage('Press Ctrl-C again to exit');
      } else {
        setStatusMessage(null);
      }
    },
    () => {
      // Double press - exit
      exit();
    },
    () => {
      // First press - clear input if not empty
      if (value) {
        onChange('');
        setCursorPosition(0);
        setMode('prompt');
      }
    },
  );

  // Double ESC handler - clears input
  const handleEscape = useDoublePress(
    (pending) => {
      if (pending && value) {
        setStatusMessage('Press Escape again to clear');
      } else {
        setStatusMessage(null);
      }
    },
    () => {
      // Double press - clear input
      if (value) {
        onChange('');
        setCursorPosition(0);
      }
    },
    () => {
      // First press - exit bash mode if active
      if (mode === 'bash') {
        setMode('prompt');
        onChange('');
        setCursorPosition(0);
      }
    },
  );

  // Handle Ctrl+G for external editor
  const handleExternalEditor = async () => {
    if (isEditorOpen) return;

    setIsEditorOpen(true);
    setStatusMessage('Opening external editor...');

    try {
      const result = await launchExternalEditor(value);
      if (result.text !== null) {
        const trimmedText = result.text.trim();
        if (trimmedText) {
          onChange(trimmedText);
          setCursorPosition(trimmedText.length);
        }
      } else if (result.error) {
        setStatusMessage(`Editor error: ${result.error.message}`);
        setTimeout(() => setStatusMessage(null), 3000);
      }
    } catch (error: any) {
      setStatusMessage(`Editor error: ${error.message}`);
      setTimeout(() => setStatusMessage(null), 3000);
    } finally {
      setIsEditorOpen(false);
      if (!pendingMessage?.startsWith('Editor error')) {
        setStatusMessage(null);
      }
    }
  };

  // Handle key input
  // Note: We allow input even when isLoading=true so user can type to interrupt
  useInput((input, key) => {
    if (isEditorOpen) return;

    // ==========================================
    // FIRST: Handle backspace/delete
    // BOTH key.backspace AND key.delete are treated as backspace
    // because some terminals report backspace as delete
    // ==========================================
    if (
      key.backspace ||
      key.delete ||
      input === '\b' ||
      input === '\x7f' ||
      input === '\x08'
    ) {
      if (cursorPosition > 0) {
        const newValue = value.slice(0, cursorPosition - 1) + value.slice(cursorPosition);
        onChange(newValue);
        setCursorPosition(cursorPosition - 1);
      } else if (mode === 'bash' && value === '') {
        setMode('prompt');
      }
      setSelectedSuggestionIndex(0);
      return;
    }

    // ==========================================
    // Handle Home key
    // ==========================================
    if ('home' in key && (key as any).home) {
      const lineStart = value.lastIndexOf('\n', cursorPosition - 1) + 1;
      setCursorPosition(lineStart);
      return;
    }

    // ==========================================
    // Handle End key
    // ==========================================
    if ('end' in key && (key as any).end) {
      let lineEnd = value.indexOf('\n', cursorPosition);
      if (lineEnd === -1) lineEnd = value.length;
      setCursorPosition(lineEnd);
      return;
    }

    // ==========================================
    // Handle PageUp/PageDown
    // ==========================================
    if (key.pageUp) {
      const lineStart = value.lastIndexOf('\n', cursorPosition - 1) + 1;
      setCursorPosition(lineStart);
      return;
    }
    if (key.pageDown) {
      let lineEnd = value.indexOf('\n', cursorPosition);
      if (lineEnd === -1) lineEnd = value.length;
      setCursorPosition(lineEnd);
      return;
    }

    // ==========================================
    // Ctrl key combinations
    // ==========================================
    if (key.ctrl) {
      switch (input) {
        case 'a': // Start of line
          setCursorPosition(0);
          return;
        case 'e': // End of line
          setCursorPosition(value.length);
          return;
        case 'b': // Back one character
          setCursorPosition(Math.max(0, cursorPosition - 1));
          return;
        case 'f': // Forward one character
          setCursorPosition(Math.min(value.length, cursorPosition + 1));
          return;
        case 'h': // Backspace (Ctrl+H)
          if (cursorPosition > 0) {
            const newValue = value.slice(0, cursorPosition - 1) + value.slice(cursorPosition);
            onChange(newValue);
            setCursorPosition(cursorPosition - 1);
          }
          return;
        case 'd': // Delete forward
          if (cursorPosition < value.length) {
            const newValue = value.slice(0, cursorPosition) + value.slice(cursorPosition + 1);
            onChange(newValue);
          }
          return;
        case 'k': // Delete to end of line
          {
            let lineEnd = value.indexOf('\n', cursorPosition);
            if (lineEnd === -1) lineEnd = value.length;
            const newValue = value.slice(0, cursorPosition) + value.slice(lineEnd);
            onChange(newValue);
          }
          return;
        case 'u': // Delete to start of line
          {
            const lineStart = value.lastIndexOf('\n', cursorPosition - 1) + 1;
            const newValue = value.slice(0, lineStart) + value.slice(cursorPosition);
            onChange(newValue);
            setCursorPosition(lineStart);
          }
          return;
        case 'w': // Delete word before
          if (cursorPosition > 0) {
            let newPos = cursorPosition - 1;
            while (newPos > 0 && value[newPos - 1] === ' ') newPos--;
            while (newPos > 0 && value[newPos - 1] !== ' ') newPos--;
            const newValue = value.slice(0, newPos) + value.slice(cursorPosition);
            onChange(newValue);
            setCursorPosition(newPos);
          }
          return;
        case 'c': // Ctrl+C
          handleCtrlC();
          return;
        case 'g': // External editor
          handleExternalEditor();
          return;
        case 'l': // Clear screen (handled by parent)
          return;
        case 'v': // Image paste (macOS)
          handleImagePaste();
          return;
      }
    }

    // ==========================================
    // Meta/Option key combinations
    // ==========================================
    if (key.meta) {
      switch (input) {
        case 'b': // Previous word
          {
            let newPos = cursorPosition - 1;
            while (newPos > 0 && value[newPos - 1] === ' ') newPos--;
            while (newPos > 0 && value[newPos - 1] !== ' ') newPos--;
            setCursorPosition(Math.max(0, newPos));
          }
          return;
        case 'f': // Next word
          {
            let newPos = cursorPosition;
            while (newPos < value.length && value[newPos] !== ' ') newPos++;
            while (newPos < value.length && value[newPos] === ' ') newPos++;
            setCursorPosition(Math.min(value.length, newPos));
          }
          return;
        case 'd': // Delete word after
          {
            let endPos = cursorPosition;
            while (endPos < value.length && value[endPos] === ' ') endPos++;
            while (endPos < value.length && value[endPos] !== ' ') endPos++;
            const newValue = value.slice(0, cursorPosition) + value.slice(endPos);
            onChange(newValue);
          }
          return;
      }
    }

    // Handle escape
    if (key.escape) {
      handleEscape();
      return;
    }

    // Clear pending message on any other key
    setStatusMessage(null);

    // Handle newline insertion
    // 1. Shift/Meta/Option + Enter => insert newline
    // 2. Backslash + Enter => remove backslash and insert newline (traditional terminal pattern)
    if (key.return) {
      // Method 1: Shift/Meta/Option + Enter
      if (key.shift || key.meta || (key as any).option) {
        const newValue = value.slice(0, cursorPosition) + '\n' + value.slice(cursorPosition);
        onChange(newValue);
        setCursorPosition(cursorPosition + 1);
        return;
      }

      // Method 2: Backslash + Enter (if previous char is \, replace with newline)
      if (cursorPosition > 0 && value[cursorPosition - 1] === '\\') {
        const newValue = value.slice(0, cursorPosition - 1) + '\n' + value.slice(cursorPosition);
        onChange(newValue);
        // Cursor stays at same position (backslash removed, newline added)
        return;
      }

      // Normal submit handling
      if (showSuggestions && commandSuggestions.length > 0) {
        // Complete the selected command
        const selected = commandSuggestions[selectedSuggestionIndex];
        if (selected) {
          onSubmit(`/${selected.name}`);
          onChange('');
          setSelectedSuggestionIndex(0);
          setCursorPosition(0);
          return;
        }
      }

      if (!value.trim()) return;

      // Prepend ! for bash mode
      const finalInput = mode === 'bash' ? `!${value}` : value;
      onSubmit(finalInput);
      onChange('');
      setMode('prompt');
      setCursorPosition(0);
      setSelectedSuggestionIndex(0);
      return;
    }

    // Handle Shift+Tab for permission mode cycling
    if (key.tab && key.shift) {
      if (onPermissionModeChange) {
        const modes: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions'];
        const currentIndex = modes.indexOf(permissionMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        onPermissionModeChange(modes[nextIndex]);
      }
      return;
    }

    // Handle suggestion navigation
    if (showSuggestions) {
      if (key.downArrow) {
        setSelectedSuggestionIndex(prev =>
          Math.min(prev + 1, commandSuggestions.length - 1)
        );
        return;
      }
      if (key.upArrow) {
        setSelectedSuggestionIndex(prev => Math.max(prev - 1, 0));
        return;
      }
      if (key.tab) {
        // Auto-complete with selected suggestion
        const selected = commandSuggestions[selectedSuggestionIndex];
        if (selected) {
          onChange(`/${selected.name}`);
          setCursorPosition(selected.name.length + 1);
        }
        return;
      }
    }

    // Handle arrow keys for cursor movement
    if (key.leftArrow) {
      // Ctrl+Left or Meta+Left - move to previous word
      if (key.ctrl || key.meta) {
        let newPos = cursorPosition - 1;
        while (newPos > 0 && value[newPos - 1] === ' ') newPos--;
        while (newPos > 0 && value[newPos - 1] !== ' ') newPos--;
        setCursorPosition(Math.max(0, newPos));
      } else {
        setCursorPosition(prev => Math.max(0, prev - 1));
      }
      return;
    }
    if (key.rightArrow) {
      // Ctrl+Right or Meta+Right - move to next word
      if (key.ctrl || key.meta) {
        let newPos = cursorPosition;
        while (newPos < value.length && value[newPos] !== ' ') newPos++;
        while (newPos < value.length && value[newPos] === ' ') newPos++;
        setCursorPosition(Math.min(value.length, newPos));
      } else {
        setCursorPosition(prev => Math.min(value.length, prev + 1));
      }
      return;
    }

    // Handle paste operations - when input has multiple characters
    // Process large input strings more efficiently
    // Large pastes may arrive in multiple chunks, so we buffer them
    const PASTE_THRESHOLD = 100; // Characters that trigger paste mode

    if (!key.ctrl && !key.meta && input && (input.length > PASTE_THRESHOLD || pasteState.timeoutId)) {
      // This looks like a paste operation - buffer the chunks
      setPasteState(({ chunks, timeoutId }) => {
        // Clear any existing timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        const newChunks = [...chunks, input];

        // Set a new timeout to finalize the paste
        const newTimeoutId = setTimeout(() => {
          setPasteState((state) => {
            // Combine all chunks and insert
            const pastedText = state.chunks.join('');
            // Normalize newlines
            const normalizedInput = pastedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            // Insert at current cursor position
            const newValue = value.slice(0, cursorPosition) + normalizedInput + value.slice(cursorPosition);
            onChange(newValue);
            setCursorPosition(cursorPosition + normalizedInput.length);
            setSelectedSuggestionIndex(0);

            return { chunks: [], timeoutId: null };
          });
        }, 100); // 100ms debounce

        return { chunks: newChunks, timeoutId: newTimeoutId };
      });
      return;
    }

    // ==========================================
    // Escape sequence fallbacks
    // Handle Home/End/Backspace escape sequences
    // ==========================================
    if (input) {
      switch (true) {
        // Home key escape sequences
        case input === '\x1b[H' || input === '\x1b[1~':
          {
            const lineStart = value.lastIndexOf('\n', cursorPosition - 1) + 1;
            setCursorPosition(lineStart);
          }
          return;
        // End key escape sequences
        case input === '\x1b[F' || input === '\x1b[4~':
          {
            let lineEnd = value.indexOf('\n', cursorPosition);
            if (lineEnd === -1) lineEnd = value.length;
            setCursorPosition(lineEnd);
          }
          return;
        // Delete key (forward delete) escape sequence
        case input === '\x1b[3~':
          if (cursorPosition < value.length) {
            const newValue = value.slice(0, cursorPosition) + value.slice(cursorPosition + 1);
            onChange(newValue);
          }
          return;
      }
    }

    // Handle smaller pastes immediately (not in chunked mode)
    if (!key.ctrl && !key.meta && input && input.length > 1) {
      // Normalize newlines (convert \r\n to \n, \r to \n)
      const normalizedInput = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      // Insert the pasted text at cursor position
      const newValue = value.slice(0, cursorPosition) + normalizedInput + value.slice(cursorPosition);
      onChange(newValue);
      setCursorPosition(cursorPosition + normalizedInput.length);
      setSelectedSuggestionIndex(0);
      return;
    }

    // Handle regular single character input
    if (input && !key.ctrl && !key.meta) {
      // Check for mode switch
      if (value === '' && input === '!' && mode === 'prompt') {
        setMode('bash');
        return;
      }

      // Normalize newline characters
      const normalizedInput = input.replace(/\r/g, '\n');

      // Insert character at cursor position
      const newValue = value.slice(0, cursorPosition) + normalizedInput + value.slice(cursorPosition);
      onChange(newValue);
      setCursorPosition(prev => prev + normalizedInput.length);
      setSelectedSuggestionIndex(0);
    }
  });

  const textInputWidth = columns - 8;

  // Get context usage info with pie chart emoji and color
  const getContextUsageInfo = (current: number, total: number) => {
    const percent = Math.round((current / total) * 100);

    // Pie chart emoji based on percentage (8 stages)
    // 🔘 empty, ◔ 1/8, ◑ 2/8, ◕ 3/8, ● full
    // Using clock faces for more granular display
    const pieEmojis = ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'];
    const pieIndex = Math.min(Math.floor(percent / 8.34), 11);
    const pie = pieEmojis[pieIndex];

    // Determine color based on usage level
    let color: string;
    if (percent >= 90) {
      color = 'red';
    } else if (percent >= 70) {
      color = 'yellow';
    } else {
      color = 'green';
    }

    return { percent, pie, color };
  };

  // Render value with cursor (supports multiline)
  const renderValueWithCursor = () => {
    if (value.length === 0) {
      return <Text inverse> </Text>;
    }

    // Split value into lines first, then find which line has the cursor
    const lines = value.split('\n');
    let charCount = 0;
    let cursorLineIndex = 0;
    let cursorPosInLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineLength = lines[i].length;
      // Check if cursor is in this line (including the position right after last char)
      if (cursorPosition <= charCount + lineLength) {
        cursorLineIndex = i;
        cursorPosInLine = cursorPosition - charCount;
        break;
      }
      // +1 for the newline character
      charCount += lineLength + 1;
      cursorLineIndex = i + 1;
      cursorPosInLine = 0;
    }

    return (
      <Box flexDirection="column">
        {lines.map((line, lineIndex) => {
          if (lineIndex === cursorLineIndex) {
            // This line contains the cursor
            const before = line.slice(0, cursorPosInLine);
            const cursorChar = line[cursorPosInLine] || ' ';
            const after = line.slice(cursorPosInLine + 1);

            return (
              <Text key={lineIndex}>
                {before}
                <Text inverse>{cursorChar}</Text>
                {after}
              </Text>
            );
          }

          // Regular line without cursor
          return <Text key={lineIndex}>{line || ' '}</Text>;
        })}
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      {/* Model info in top-right corner */}
      {modelInfo && (() => {
        const usage = getContextUsageInfo(modelInfo.currentTokens, modelInfo.contextLength);
        return (
          <Box justifyContent="flex-end" marginBottom={0}>
            <Text dimColor>[{modelInfo.provider}] {modelInfo.name}: </Text>
            <Text color={usage.color as any}>
              {Math.round(modelInfo.currentTokens / 1000)}k
            </Text>
            <Text dimColor> / {Math.round(modelInfo.contextLength / 1000)}k </Text>
            <Text>{usage.pie}</Text>
            <Text color={usage.color as any}> {usage.percent}%</Text>
          </Box>
        );
      })()}

      {/* Input box with border */}
      <Box
        alignItems="flex-start"
        justifyContent="flex-start"
        borderColor={mode === 'bash' ? theme.bashBorder : (isLoading ? theme.secondaryText : theme.secondaryBorder)}
        borderDimColor={isLoading}
        borderStyle="round"
        marginTop={1}
        width="100%"
      >
        {/* Mode indicator */}
        <Box
          alignItems="flex-start"
          alignSelf="flex-start"
          flexWrap="nowrap"
          justifyContent="flex-start"
          width={3}
        >
          {mode === 'bash' ? (
            <Text color={theme.bashBorder}>&nbsp;!&nbsp;</Text>
          ) : (
            <Text color={isLoading ? theme.secondaryText : undefined}>
              &nbsp;&gt;&nbsp;
            </Text>
          )}
        </Box>

        {/* Text input area */}
        <Box paddingRight={1} width={textInputWidth}>
          {value.length === 0 && placeholder ? (
            <Text color={theme.secondaryText}>{placeholder}</Text>
          ) : (
            renderValueWithCursor()
          )}
        </Box>
      </Box>

      {/* Command suggestions */}
      {showSuggestions && (
        <Box
          flexDirection="row"
          justifyContent="space-between"
          paddingX={2}
          paddingY={0}
        >
          <Box flexDirection="column">
            {commandSuggestions.map((cmd, index) => {
              const isSelected = index === selectedSuggestionIndex;
              return (
                <Box key={cmd.name} flexDirection="row">
                  <Text
                    color={isSelected ? theme.suggestion : undefined}
                    dimColor={!isSelected}
                  >
                    {isSelected ? '◆ ' : '  '}
                    /{cmd.name}
                  </Text>
                  <Text dimColor> - {cmd.description}</Text>
                </Box>
              );
            })}
            {/* Navigation hints for suggestions */}
            <Box marginTop={1}>
              <Text dimColor>
                ↑↓ navigate · Tab complete · Enter select · Esc close
              </Text>
            </Box>
          </Box>
        </Box>
      )}

      {/* Hints bar below input */}
      {!showSuggestions && (
        <Box
          flexDirection="row"
          justifyContent="space-between"
          paddingX={2}
          paddingY={0}
          width="100%"
        >
          {/* Left side: Permission mode indicator, pending message, or status message */}
          <Box flexShrink={0}>
            {pendingMessage ? (
              <Text color="yellow">
                📝 Queued: {pendingMessage.slice(0, 30)}{pendingMessage.length > 30 ? '...' : ''}
              </Text>
            ) : statusMessage ? (
              <Text color={theme.warning}>{statusMessage}</Text>
            ) : (
              <Text color={MODE_CONFIGS[permissionMode].color as any}>
                {MODE_CONFIGS[permissionMode].icon} {MODE_CONFIGS[permissionMode].label}
              </Text>
            )}
          </Box>

          {/* Right side: Keyboard hints and status */}
          <Box flexShrink={0}>
            {isLoading ? (
              <Text dimColor>
                <Text bold>esc</Text> interrupt · <Text bold>enter</Text> queue message
              </Text>
            ) : (
              <Text dimColor>
                <Text color={mode === 'bash' ? theme.bashBorder : undefined}>!</Text> bash
                {' · '}<Text>/</Text> cmd
                {' · '}<Text>\⏎</Text> newline
                {' · '}<Text bold>ctrl+g</Text> editor
                {' · '}<Text bold>shift+tab</Text> mode
              </Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

export const PromptInput = memo(PromptInputComponent);
