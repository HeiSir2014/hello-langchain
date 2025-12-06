# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Build TypeScript
bun run build

# Run in dev mode (uses bun to run tsx directly)
bun start

# Run with arguments
bun start -m qwen3:4b "your message"
bun start --list    # List available models
bun start --help    # Show help

# Type checking only
bun run typecheck

# Run tests
bun test
```

## Architecture Overview

This is **YTerm**, a LangGraph-based AI Agent CLI with a React/Ink terminal UI, supporting multiple LLM providers with tool calling capabilities.

### Project Structure

```
src/
├── cli.tsx                 # Entry point - Commander CLI + Ink render
├── logger.ts               # Winston logger with session-based files in logs/
├── core/
│   ├── config.ts           # Model definitions, provider configs, env loading
│   ├── settings.ts         # Persistent settings (~/.yterm/settings.json)
│   ├── permissions.ts      # Permission system
│   ├── agent/
│   │   ├── index.ts        # LangGraph StateGraph (agent, tools, confirm, summarize nodes)
│   │   ├── models.ts       # Unified chat model factory for all providers
│   │   ├── memory.ts       # Token counting, message trimming, summarization
│   │   └── events.ts       # AgentEventEmitter for UI communication
│   ├── context/
│   │   └── index.ts        # Context injection (CLAUDE.md, todo list)
│   ├── services/
│   │   ├── ollama.ts       # Ollama API client with model caching
│   │   ├── openai.ts       # OpenAI API service
│   │   ├── anthropic.ts    # Anthropic API service
│   │   ├── openrouter.ts   # OpenRouter API service
│   │   └── reminder.ts     # System reminder service (task/security/performance)
│   ├── utils/
│   │   ├── PersistentShell.ts  # Persistent shell session management
│   │   └── output.ts       # Output utilities (large output handling)
│   └── tools/
│       ├── index.ts        # Tool exports and descriptions
│       ├── types.ts        # Tool metadata and type definitions
│       ├── bash.ts         # Bash, BashOutput, KillShell tools
│       ├── file.ts         # Read, Write, Edit, Glob, Grep, LS tools
│       ├── todo.ts         # TodoWrite tool for task management
│       ├── web.ts          # WebSearch, WebFetch tools
│       └── location.ts     # Location tool (IP geolocation)
└── ui/
    ├── app.tsx             # Root component with ThemeProvider
    ├── screens/
    │   └── REPL.tsx        # Main REPL screen with message handling
    ├── components/
    │   ├── Message.tsx     # Message wrapper component
    │   ├── Spinner.tsx     # Loading spinner
    │   ├── PromptInput.tsx # User input component
    │   ├── Logo.tsx        # YTerm logo display
    │   ├── Help.tsx        # Help display component
    │   ├── ModelConfig.tsx # Model configuration UI
    │   ├── PressEnterToContinue.tsx
    │   ├── messages/       # Message type components
    │   │   ├── UserMessage.tsx
    │   │   ├── AssistantMessage.tsx
    │   │   ├── ToolUseMessage.tsx
    │   │   ├── ToolResultMessage.tsx
    │   │   ├── ToolCallGroup.tsx
    │   │   ├── BashInputMessage.tsx
    │   │   ├── BashOutputMessage.tsx
    │   │   ├── ErrorMessage.tsx
    │   │   └── SystemMessage.tsx
    │   └── permissions/    # Permission request components
    │       ├── PermissionRequest.tsx
    │       ├── PermissionRequestTitle.tsx
    │       ├── PermissionSelect.tsx
    │       ├── BashPermissionRequest.tsx
    │       ├── FileEditPermissionRequest.tsx
    │       ├── FileWritePermissionRequest.tsx
    │       ├── FilesystemPermissionRequest.tsx
    │       └── FallbackPermissionRequest.tsx
    ├── commands/           # Slash commands
    │   ├── index.ts        # Command registry and types
    │   ├── clear.ts        # /clear - Clear conversation
    │   ├── help.tsx        # /help - Show help
    │   ├── model.tsx       # /model - Switch model
    │   └── compact.ts      # /compact - Compress history
    ├── hooks/
    │   ├── useAgentEvents.ts   # Subscribe to agent events
    │   ├── useTerminalSize.ts  # Terminal dimensions
    │   └── useDoublePress.ts   # Double-press detection
    ├── utils/
    │   ├── theme.ts        # Color theme definitions
    │   ├── markdown.ts     # Markdown rendering
    │   ├── terminal.ts     # Terminal utilities
    │   ├── bash.ts         # Bash output formatting
    │   ├── externalEditor.ts # External editor support
    │   └── imagePaste.ts   # Clipboard image paste (macOS)
    └── types/
        └── messages.ts     # Message type definitions
```

### Core Flow

```
User Input → REPL → multiTurnChat() → LangGraph StateGraph
                                            ↓
                          Agent Node → shouldContinue?
                                ↓              ↓
                    [has tool_calls]    [no tool_calls]
                          ↓                   ↓
               [sensitive?]                  END
                  ↓      ↓
           confirm_tools  tools
                  ↓        ↓
            [approved?]    ↓
                  ↓        ↓
                tools ←────┘
                  ↓
            checkMessages
                  ↓
         [token limit?] → summarize → agent
                  ↓
                agent
```

### Event-Driven UI Communication

The agent emits events via `AgentEventEmitter` (`src/core/agent/events.ts`):
- `thinking` - LLM is processing
- `streaming` - Streaming response content
- `tool_use` - Tool call initiated
- `tool_result` - Tool execution completed
- `response` - Final response ready
- `confirm_required` - Sensitive tool needs approval
- `error` - Error occurred
- `done` - Request completed

The `useAgentEvents` hook in the UI subscribes to these events.

### Model Provider Pattern

Models are created via factory in `src/core/agent/models.ts`:
- **Ollama**: Dynamic model discovery from API, supports local and cloud instances
- **OpenAI**: Standard OpenAI API with custom base URL support
- **Anthropic**: Claude models via Anthropic API
- **OpenRouter**: Multiple providers via single API

Provider/model selection priority: CLI args > `~/.yterm/settings.json` > `.env.local` > `.env`.

### Memory Management

- Token estimation: ~1.5 chars/token for Chinese, ~4 chars/token for English
- Auto-trim at 70% of model's context window
- Uses `RemoveMessage` for proper LangGraph message deletion
- LLM-generated summaries preserve key information when trimming
- Manual compaction via `/compact` command

### Tool System

**Built-in tools** (13 total):
| Tool | Description | Category | Read-Only |
|------|-------------|----------|-----------|
| `Bash` | Execute shell commands (with background support) | bash | No |
| `BashOutput` | Get output from background shell | bash | Yes |
| `KillShell` | Terminate background shell | bash | No |
| `Read` | Read file contents with line numbers | file | Yes |
| `Write` | Write content to file | file | No |
| `Edit` | Edit file via string replacement | file | No |
| `Glob` | File pattern matching (e.g., `**/*.ts`) | search | Yes |
| `Grep` | Search text in files (ripgrep-based) | search | Yes |
| `LS` | List directory contents | file | Yes |
| `TodoWrite` | Task list management | task | No |
| `WebSearch` | Search the web via DuckDuckGo | search | Yes |
| `WebFetch` | Fetch and analyze URL content | search | Yes |
| `Location` | Get current location based on IP | other | Yes |

**Tool metadata** (`src/core/tools/types.ts`):
- `isReadOnly`: Safe for concurrent execution
- `isConcurrencySafe`: Can run with other tools
- `needsPermission`: Requires user confirmation
- `category`: Tool grouping (file, bash, search, task, other)

**Sensitive tools** (require confirmation): `Bash`, `Write`, `Edit`

### Permission System

Permission management (`src/core/permissions.ts`):

```typescript
// Safe commands (no confirmation needed)
const SAFE_COMMANDS = ["git status", "git diff", "pwd", "ls", ...];

// Command prefix matching for "remember" feature
// "npm install foo" → grants "npm:*" permission
const prefixTools = ["npm", "yarn", "bun", "git", "docker", ...];
```

**Permission modes**:
- `default`: Sensitive tools need confirmation
- `acceptEdits`: Auto-allow Edit/Write operations
- `bypassPermissions`: Skip all permission checks (use with caution)

**Session permissions**: Directory-level write/edit permissions, cleared on session end.

### Persistent Shell

`PersistentShell` (`src/core/utils/PersistentShell.ts`) maintains shell state across commands:

- **Cross-platform**: macOS, Linux, Windows (Git Bash, MSYS2, WSL)
- **State preservation**: Environment variables, working directory persist
- **Interrupt support**: AbortSignal cancellation
- **Streaming output**: Real-time output callbacks

### System Reminder Service

Context-aware hint injection (`src/core/services/reminder.ts`):

| Reminder Type | Trigger | Priority |
|---------------|---------|----------|
| Todo reminder | Empty or updated todo list | Medium |
| Security reminder | First file access | High |
| Performance reminder | Session > 30 minutes | Low |

### Web Tools

**WebSearch** (`src/core/tools/web.ts`):
- Uses `duckduckgo-websearch` package
- No API key required
- Returns title, snippet, and link for each result

**WebFetch** (`src/core/tools/web.ts`):
- Fetches URL content, converts HTML to Markdown
- Uses current model for AI analysis
- Rate limited (20 req/min)

### Location Tool

IP-based geolocation (`src/core/tools/location.ts`):

**Providers** (in fallback order):
1. pconline (China optimized, GBK encoded)
2. ip-api.com
3. ip.sb
4. ipwhois.app
5. ipapi.co
6. ipinfo.io

**Features**: 30-minute cache, 5-second timeout, no API key required.

### Large Output Handling

`src/core/utils/output.ts` handles outputs > 30KB:
- Writes to temp file in `/tmp/yterm-tools/`
- Returns metadata with preview (first 20 lines)

### Image Paste Support

`src/ui/utils/imagePaste.ts` (macOS only):
- Reads PNG from clipboard via osascript
- Validates PNG/JPEG magic bytes
- Returns base64 encoded image

### Slash Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `/help` | `/h` | Show help information |
| `/clear` | `/c` | Clear conversation history |
| `/model` | `/m` | Show/switch model |
| `/compact` | - | Compress conversation history |

## Environment Variables

Key variables (see `.env.example`):

```bash
# Provider selection
USE_PROVIDER=OLLAMA  # OLLAMA | OPENROUTER | OPENAI | ANTHROPIC

# Ollama
OLLAMA_MODEL_NAME=qwen3:4b
OLLAMA_HOST=http://localhost:11434
OLLAMA_CLOUD_HOST=https://ollama.com
OLLAMA_CLOUD_API_KEY=

# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_MODEL_NAME=x-ai/grok-2-1212
OPENROUTER_MODEL_CONTEXT_LENGTH=131072

# OpenAI
OPENAI_API_KEY=
OPENAI_MODEL_NAME=gpt-4o
OPENAI_MODEL_CONTEXT_LENGTH=128000
OPENAI_BASE_URL=https://api.openai.com/v1

# Anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL_NAME=claude-sonnet-4-20250514
ANTHROPIC_MODEL_CONTEXT_LENGTH=200000
ANTHROPIC_BASE_URL=https://api.anthropic.com

# Logging
LOG_LEVEL=info  # error | warn | info | debug
```

## Code Conventions

- **Module system**: ESM with `.js` extensions in imports
- **UI framework**: React 19 + Ink 6 for terminal UI
- **Type safety**: TypeScript with Zod schemas for runtime validation
- **State management**: LangGraph StateGraph with MemorySaver checkpointer
- **Logging**: Winston logger with session-based files in `logs/`
- **Event system**: EventEmitter for agent-UI decoupling
- **Error handling**: Centralized error emission via `emitError()`

## Adding New Features

### Adding a New Tool

1. Create tool in `src/core/tools/` using Zod schema:
```typescript
import { z } from "zod";
import { tool } from "@langchain/core/tools";

export const MyTool = tool(
  async (input) => {
    // Implementation
    return result;
  },
  {
    name: "MyTool",
    description: "Tool description",
    schema: z.object({
      param: z.string().describe("Parameter description"),
    }),
  }
);
```

2. Export from `src/core/tools/index.ts`
3. Add to `tools` array and `toolDescriptions`
4. Add metadata to `TOOL_METADATA` in `src/core/tools/types.ts`

### Adding a New Slash Command

1. Create command in `src/ui/commands/`:
```typescript
import { Command } from './index.js';

const myCommand: Command = {
  name: 'mycommand',
  description: 'Command description',
  isEnabled: true,
  isHidden: false,
  aliases: ['mc'],
  type: 'local',
  userFacingName: () => 'mycommand',
  async call(args, context) {
    // Implementation
    return 'Result message';
  },
};

export default myCommand;
```

2. Import and add to `COMMANDS` array in `src/ui/commands/index.ts`

### Adding a New Model Provider

1. Create service in `src/core/services/`
2. Add provider config to `src/core/config.ts`
3. Add model creation logic to `src/core/agent/models.ts`
4. Update settings schema in `src/core/settings.ts`

### Adding Web/Search Tools

For tools that fetch external data:

1. Create tool in `src/core/tools/` with proper error handling and timeouts
2. Use caching when appropriate (see `location.ts` for example)
3. Implement multiple providers with fallback for reliability
4. Set `isReadOnly: true` and `isConcurrencySafe: true` in metadata
5. Consider rate limiting for external APIs

### Working with PersistentShell

```typescript
import { PersistentShell } from '../utils/PersistentShell.js';

// Get singleton instance
const shell = PersistentShell.getInstance();

// Execute with streaming output
const result = await shell.exec(
  'npm install',
  abortSignal,
  30000, // timeout
  (stdout, stderr) => {
    // Streaming callback
  }
);

// Get current working directory
const cwd = shell.pwd();
```
