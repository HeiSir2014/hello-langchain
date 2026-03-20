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
│   │   ├── initAgent.ts    # Init agent using LangChain 1.0 createAgent with middleware
│   │   ├── planAgent.ts    # Plan agent using LangChain 1.0 createAgent (read-only tools)
│   │   ├── supervisor.ts   # Multi-agent supervisor (researcher + coder coordination)
│   │   ├── checkpointer.ts # Checkpointer factory (SQLite persistent / MemorySaver fallback)
│   │   ├── models.ts       # Unified chat model factory for all providers
│   │   ├── memory.ts       # Token counting, message trimming, summarization
│   │   └── events.ts       # AgentEventEmitter for UI communication
│   ├── skills/
│   │   ├── index.ts        # Skill system exports
│   │   ├── types.ts        # Skill type definitions
│   │   └── loader.ts       # Skill loader from markdown files
│   ├── context/
│   │   └── index.ts        # Context injection (CLAUDE.md, todo list)
│   ├── services/
│   │   ├── ollama.ts       # Ollama API client with model caching
│   │   ├── openai.ts       # OpenAI API service
│   │   ├── anthropic.ts    # Anthropic API service
│   │   ├── openrouter.ts   # OpenRouter API service
│   │   ├── codebase.ts     # Codebase analysis service (directory structure, git, code style)
│   │   ├── projectConfig.ts # Project-level configuration and onboarding state
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
│       ├── location.ts     # Location tool (IP geolocation)
│       └── plan.ts         # ExitPlanMode, SavePlan, ReadPlan tools
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
    ├── commands/           # Slash commands (supports local, local-jsx, prompt, agent types)
    │   ├── index.ts        # Command registry and types (LocalCommand, PromptCommand, AgentCommand)
    │   ├── init.ts         # /init - Analyze codebase and generate CLAUDE.md (AgentCommand)
    │   ├── plan.ts         # /plan - Enter plan mode (read-only research)
    │   ├── exitPlan.ts     # /exit-plan - Exit plan mode
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

### Core Flow (Main Agent)

```text
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

### Agent Architecture (LangChain 1.0 + LangGraph 1.2)

The project uses a hybrid approach:
- **Main agent**: Custom LangGraph `StateGraph` for full control over the agent loop
- **Sub-agents**: LangChain 1.0 `createAgent` with middleware for simpler ReAct agents
- **Supervisor**: `@langchain/langgraph-supervisor` for multi-agent coordination

**Init Agent** (`src/core/agent/initAgent.ts`) - Uses `createAgent` from `langchain`:
```text
User Request → codebaseContextMiddleware (beforeAgent) → createAgent ReAct Loop → WriteClaudeMd tool → Done
```

**Plan Agent** (`src/core/agent/planAgent.ts`) - Uses `createAgent` from `langchain`:
```text
User Request → createAgent ReAct Loop (read-only tools) → ExitPlanMode → Done
```

**Supervisor** (`src/core/agent/supervisor.ts`) - Uses `createSupervisor`:
```text
User Request → Supervisor → researcher agent (read-only) ↔ coder agent (read-write)
```

**Persistence** (`src/core/agent/checkpointer.ts`):
- SQLite checkpointer (`@langchain/langgraph-checkpoint-sqlite`) for durable state
- Stored at `~/.yterm/data/checkpoints.db`
- Falls back to `MemorySaver` if SQLite unavailable

**Key patterns:**
- **Main agent**: `StateGraph` with `Annotation.Root()` for type-safe state management
- **Sub-agents**: `createAgent` from `langchain` with `createMiddleware` for context injection
- **Supervisor**: `createSupervisor` with `createReactAgent` worker agents
- **Checkpointer**: `SqliteSaver` for persistent state across sessions
- **Event emission**: Communicate with UI via shared event system

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

### Memory & Persistence

- **SQLite checkpointer**: Durable state persistence at `~/.yterm/data/checkpoints.db`
- **Fallback**: `MemorySaver` (in-memory) if SQLite unavailable
- Token estimation: ~1.5 chars/token for Chinese, ~4 chars/token for English
- Auto-trim at 92% of model's context window
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

### Permission Modes and Plan Mode

The system supports four permission modes, cycled with **Shift+Tab**:

| Mode | Icon | Description | Allowed Tools |
|------|------|-------------|---------------|
| `default` | ⏵ | Ask for confirmation | All |
| `acceptEdits` | ⏵⏵ | Auto-approve edits | All |
| `plan` | 📝 | Research/planning only | Read-only tools only |
| `bypassPermissions` | ⏵⏵⏵ | No confirmations | All |

**Plan Mode** (`src/core/agent/planAgent.ts`):

- Enter with `/plan` command or Shift+Tab cycling
- **Exploration tools**: `Read`, `Glob`, `Grep`, `LS`, `WebSearch`, `WebFetch`
- **Planning tools**: `SavePlan`, `ReadPlan`, `TodoWrite` (can write plans, not code)
- **Control**: `ExitPlanMode` to exit
- Exit with `/exit-plan` or `ExitPlanMode` tool

### Skill System

Skills are specialized agent configurations (`src/core/skills/`):

- **Built-in skills**: `general-purpose`, `code-writer`, `researcher`, `planner`
- **User skills**: `~/.yterm/skills/*.md`
- **Project skills**: `.yterm/skills/*.md` (highest priority)

Skills define tool restrictions, system prompts, and model overrides via markdown frontmatter.

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
| `/init` | `/i` | Analyze codebase and generate CLAUDE.md |
| `/plan` | `/p` | Enter plan mode (read-only research) |
| `/exit-plan` | `/ep` | Exit plan mode |
| `/supervisor` | `/sup`, `/multi` | Run multi-agent supervisor (researcher + coder) |

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

**Command Types:**
- `local`: Simple command returning a string result
- `local-jsx`: Command rendering a React component
- `prompt`: Command that generates a prompt for the main agent
- `agent`: Command that runs a specialized LangGraph sub-agent

1. Create command in `src/ui/commands/`:

```typescript
import { Command } from './index.js';

// Local command example
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

// Agent command example (uses LangGraph sub-agent)
const myAgentCommand: Command = {
  type: 'agent',
  name: 'myagent',
  description: 'Run specialized agent',
  isEnabled: true,
  isHidden: false,
  progressMessage: 'running agent...',
  async runAgent(args, context) {
    const { runMyAgent } = await import('../../core/agent/myAgent.js');
    return await runMyAgent(args);
  },
  userFacingName: () => 'myagent',
};

export default myCommand;
```

2. Import and add to `COMMANDS` array in `src/ui/commands/index.ts`

### Adding a New LangGraph Sub-Agent

For specialized tasks requiring custom graphs (like `/init`):

1. Create agent in `src/core/agent/myAgent.ts`:

```typescript
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// 1. Define state with Annotation
const MyAgentState = Annotation.Root({
  input: Annotation<string>({ reducer: (_, y) => y }),
  result: Annotation<string | null>({ reducer: (_, y) => y, default: () => null }),
  messages: Annotation<BaseMessage[]>({ reducer: (x, y) => [...x, ...y], default: () => [] }),
  status: Annotation<"pending" | "completed" | "error">({ reducer: (_, y) => y, default: () => "pending" }),
});

// 2. Define specialized tools
const myTool = tool(
  async ({ param }: { param: string }) => { /* ... */ },
  { name: "MyTool", description: "...", schema: z.object({ param: z.string() }) }
);

// 3. Create nodes
async function processNode(state: typeof MyAgentState.State) {
  // Use callChatModel for LLM calls
  // Emit events via emitThinking, emitToolUse, etc.
  return { /* state updates */ };
}

// 4. Build graph with conditional edges
const graph = new StateGraph(MyAgentState)
  .addNode("process", processNode)
  .addNode("tools", new ToolNode([myTool]))
  .addEdge(START, "process")
  .addConditionalEdges("process", shouldExecuteTools)
  .addEdge("tools", "process")
  .compile();

// 5. Export runner function
export async function runMyAgent(input: string) {
  const result = await graph.invoke({ input });
  return { success: result.status === "completed", message: result.result || "" };
}
```

2. Create command in `src/ui/commands/` using `type: 'agent'`

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
