# YTerm

[中文版本](./README.md) | English

YTerm is a LangGraph-based AI terminal assistant with a React/Ink terminal UI, supporting tool calling capabilities across multiple LLM providers.

## Features

- **LangGraph State Machine**: Build conversation flows with conditional branching, state persistence, and interrupt recovery
- **React/Ink Terminal UI**: Modern terminal interface with colored output, Markdown rendering, and interactive components
- **Multi-Provider Support**: Ollama, OpenRouter, OpenAI, and Anthropic
- **Local + Cloud Models**: Support for local deployment and cloud APIs with dynamic model discovery and caching
- **Tool Calling**: 13 built-in tools for file operations, command execution, content search, task management, and more
- **Smart Memory Management**: Automatic token counting, message trimming, and LLM-driven history summarization for long conversations
- **Event-Driven Architecture**: Agent and UI layers communicate via EventEmitter decoupling
- **Tool Confirmation**: Sensitive tools (Bash/Write/Edit) require user confirmation via LangGraph interrupt
- **Comprehensive Logging**: Winston-based detailed execution logs organized by session
- **Persistent Settings**: User settings stored in `~/.yterm/settings.json`
- **Task Management**: Built-in TodoWrite tool for task list management and progress tracking
- **Context Injection**: Automatic reading and injection of CLAUDE.md file content for project-level instructions
- **Request Interruption**: Support for interrupting ongoing requests via AbortController
- **Web Search & Fetch**: Built-in WebSearch and WebFetch tools for real-time web information retrieval
- **IP Geolocation**: Location tool with multi-API fallback, optimized for both China and international users
- **Persistent Shell**: PersistentShell maintains session state, supporting macOS/Linux/Windows (Git Bash/WSL)
- **Smart Permission System**: Intelligent permission management with command prefix matching and session-level permissions
- **System Reminder Service**: Context-aware reminder system with task, security, and performance hints
- **Clipboard Image Paste**: Support for pasting images from clipboard (macOS)
- **Large Output Handling**: Automatically writes oversized output to temp files to avoid memory overflow

## Built-in Tools

| Tool | Description | Type |
|------|-------------|------|
| `Bash` | Execute shell commands (with background support) | Sensitive |
| `BashOutput` | Get output from background shell | Read-only |
| `KillShell` | Terminate running background shell | - |
| `Read` | Read file contents (with line numbers) | Read-only |
| `Write` | Write content to file | Sensitive |
| `Edit` | Edit file (string replacement) | Sensitive |
| `Glob` | File pattern matching (e.g., `**/*.ts`) | Read-only |
| `Grep` | Search text in files (ripgrep-based) | Read-only |
| `LS` | List directory contents | Read-only |
| `TodoWrite` | Task list management with progress tracking | - |
| `WebSearch` | Search the web using DuckDuckGo | Read-only |
| `WebFetch` | Fetch and analyze web content | Read-only |
| `Location` | Get current location based on IP address | Read-only |

**Tool Types**:
- **Read-only**: Safe read-only operations, supports concurrent execution
- **Sensitive**: Requires user confirmation before execution
- **-**: Regular tool, no confirmation needed

## Supported Models

### Model Providers

#### Ollama (Local + Cloud)
- **Local Models**: Dynamic discovery of installed models via Ollama API
- **Cloud Models**: Access cloud models via Ollama Cloud API
- **Features**: Model caching, smart discovery, tool calling detection

#### OpenRouter
- **Features**: Dynamic retrieval of available OpenRouter model list
- **Advantage**: Single API access to multiple model providers

#### OpenAI
- **Configuration**: Single model configuration (via environment variables)
- **Default Model**: gpt-4o
- **Features**: Full tool calling support

#### Anthropic
- **Configuration**: Single model configuration (via environment variables)
- **Default Model**: claude-sonnet-4-20250514
- **Features**: Full tool calling support

### View Available Models

```bash
# List all available models (requires network connection)
yterm --list

# Interactive mode command
/list
```

### Model Selection Priority

1. **CLI Arguments**: `-m, --model <name>`
2. **Settings File**: `~/.yterm/settings.json`
3. **Environment Variables**: `.env.local` or `.env`
4. **Defaults**: Based on current provider settings

## Quick Start

### Requirements

- **Node.js**: 18+ (recommend [Bun](https://bun.sh/) for best performance)
- **[Ollama](https://ollama.ai/)**: For local model execution (optional)
- **Package Manager**: Bun (recommended) or npm

### Installation

```bash
# Clone the project
git clone git@github.com:HeiSir2014/hello-langchain.git
cd hello-langchain

# Install dependencies (using Bun)
bun install

# Or using npm
npm install
```

### Configuration

#### Option 1: Environment Variables (`.env` or `.env.local`)

```env
# Select model provider
USE_PROVIDER=OLLAMA

# Ollama configuration
OLLAMA_MODEL_NAME=qwen3:4b
OLLAMA_HOST=http://localhost:11434
OLLAMA_CLOUD_HOST=https://ollama.com
OLLAMA_CLOUD_API_KEY=your_ollama_cloud_key

# OpenRouter configuration
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL_NAME=x-ai/grok-2-1212
OPENROUTER_MODEL_CONTEXT_LENGTH=131072

# OpenAI configuration
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL_NAME=gpt-4o
OPENAI_MODEL_CONTEXT_LENGTH=128000
OPENAI_BASE_URL=https://api.openai.com/v1

# Anthropic configuration
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL_NAME=claude-sonnet-4-20250514
ANTHROPIC_MODEL_CONTEXT_LENGTH=200000
ANTHROPIC_BASE_URL=https://api.anthropic.com

# Log level
LOG_LEVEL=info
```

#### Option 2: Interactive Setup (Recommended)

On first run, the system will prompt you for configuration. Settings are saved in `~/.yterm/settings.json`.

### Build and Run

#### Option 1: Global Installation (Recommended)

```bash
# Build the project
bun run build

# Global install
bun install -g .

# Use YTerm command
yterm

# View all available models
yterm --list

# View help
yterm --help

# Run single conversation with specified model
yterm -m claude-3-5-sonnet "Explain what LangGraph is"
```

#### Option 2: Local Run

```bash
# Development mode (recommended) - run TypeScript directly
bun start

# Or use built code
bun run build
node dist/cli.js
```

### First Run

```bash
# Start YTerm (will prompt for configuration)
yterm

# Or view available models
yterm --list
```

## Usage

### Interactive Commands

| Command | Description |
|---------|-------------|
| `/help`, `/h` | Show help information |
| `/clear`, `/c` | Clear conversation history |
| `/compact` | Compress conversation history (preserve key info) |
| `/model`, `/m` | Show/switch model |
| `/exit`, `/quit` | Exit program |

### Basic Usage

1. **Start YTerm**: `yterm`
2. **Enter messages**: Type your questions or instructions directly
3. **Use tools**: The model will automatically call necessary tools (file reading, command execution, etc.)
4. **Confirm sensitive operations**: System will request confirmation for Bash, Write, Edit tools

### Tool Calling Flow

```
User Input → Model Analysis → Tool Call → Execution Result → Model Response
```

When the model needs to use tools, it displays:
- ● Thinking... (model processing)
- ● Tool Name (tool calling)
- ● Final Response (tool execution complete)

### Usage Examples

#### Basic File Operations

```
> List files in current directory

● Thinking...

● LS(path=.)

Current directory contains:
- src/                    # Source code directory
- logs/                   # Log files directory
- node_modules/           # Dependencies directory
- package.json            # Project configuration
- tsconfig.json           # TypeScript configuration
- README.md               # Project documentation
- .env.example            # Environment variables example
```

#### Tool Call Example

```
> View package.json file content

● Thinking...

● Read(file_path=package.json)

● package.json content:
{
  "name": "yterm",
  "version": "1.0.0",
  "description": "AI Terminal Assistant...",
  "scripts": {
    "start": "bun run src/cli.tsx",
    "build": "tsc"
  }
}
```

#### Task Management Example

```
> I need to complete a project with requirements, design, development, and testing phases

● Thinking...

● TodoWrite

Task list created:
1. ○ Requirements Analysis [pending]
2. ○ System Design [pending]
3. ○ Development [pending]
4. ○ Testing [pending]
```

#### Multi-Model Switching Example

```
> /model gpt-4o
Switched to GPT-4o model

> Explain what LangGraph is

● Thinking...

LangGraph is a framework in the LangChain ecosystem for building multi-agent applications...
```

#### Bash Command Example

```
> Run `ls -la` command

● Thinking...

● Bash(command="ls -la", run_in_background=false)

total 24
drwxr-xr-x  5 user  staff   160 Dec  6 10:00 .
drwxr-xr-x  3 user  staff    96 Dec  6 09:30 ..
-rw-r--r--  1 user  staff  1024 Dec  6 10:00 README.md
-rw-r--r--  1 user  staff   512 Dec  6 09:45 package.json
```

## Project Structure

```
hello-langchain/
├── src/
│   ├── cli.tsx                 # Entry point - Commander CLI + Ink render
│   ├── logger.ts               # Winston logging system
│   ├── core/
│   │   ├── config.ts           # Model definitions, provider configs, env loading
│   │   ├── settings.ts         # Persistent settings (~/.yterm/settings.json)
│   │   ├── agent/
│   │   │   ├── index.ts        # LangGraph StateGraph (agent, tools, confirm, summarize nodes)
│   │   │   ├── models.ts       # Unified chat model factory for all providers
│   │   │   ├── memory.ts       # Token counting, message trimming, summarization
│   │   │   └── events.ts       # AgentEventEmitter for UI communication
│   │   ├── context/
│   │   │   └── index.ts        # Context injection (CLAUDE.md, todo list)
│   │   ├── services/
│   │   │   ├── ollama.ts       # Ollama API client with model caching
│   │   │   ├── openai.ts       # OpenAI API service
│   │   │   ├── anthropic.ts    # Anthropic API service
│   │   │   ├── openrouter.ts   # OpenRouter API service
│   │   │   └── reminder.ts     # System reminder service (task/security/performance)
│   │   ├── utils/
│   │   │   ├── PersistentShell.ts  # Persistent shell session management
│   │   │   └── output.ts       # Output utilities (large output handling)
│   │   ├── permissions.ts      # Permission system
│   │   └── tools/
│   │       ├── index.ts        # Tool exports and descriptions
│   │       ├── types.ts        # Tool metadata and type definitions
│   │       ├── bash.ts         # Bash, BashOutput, KillShell tools
│   │       ├── file.ts         # Read, Write, Edit, Glob, Grep, LS tools
│   │       ├── todo.ts         # TodoWrite task management tool
│   │       ├── web.ts          # WebSearch, WebFetch web tools
│   │       └── location.ts     # Location IP geolocation tool
│   └── ui/
│       ├── app.tsx             # Root component, ThemeProvider
│       ├── screens/
│       │   └── REPL.tsx        # Main REPL screen, message handling
│       ├── components/
│       │   ├── Message.tsx     # Message wrapper component
│       │   ├── Spinner.tsx     # Loading animation
│       │   ├── PromptInput.tsx # User input component
│       │   ├── Logo.tsx        # YTerm logo display
│       │   ├── Help.tsx        # Help information display
│       │   ├── ModelConfig.tsx # Model configuration UI
│       │   ├── messages/       # Message type components
│       │   └── permissions/    # Permission request components
│       ├── commands/           # Slash commands (/clear, /help, /model, /compact)
│       ├── hooks/              # React hooks (useAgentEvents, useTerminalSize, etc.)
│       ├── utils/
│       │   ├── theme.ts        # Color theme definitions
│       │   ├── markdown.ts     # Markdown rendering
│       │   ├── terminal.ts     # Terminal utilities
│       │   ├── bash.ts         # Bash output formatting
│       │   ├── externalEditor.ts # External editor support
│       │   └── imagePaste.ts   # Clipboard image paste (macOS)
│       └── types/              # TypeScript type definitions
├── logs/                       # Session log files
├── ~/.yterm/                   # User settings directory
│   └── settings.json           # Persistent settings
├── package.json
├── tsconfig.json
├── CLAUDE.md                   # Claude Code development guide
└── README.md
```

## Tech Stack

### Core Frameworks
- **TypeScript** - Type-safe development experience
- **React 19** + **Ink 6** - Terminal UI framework
- **LangGraph** - Conversation state machine and flow control
- **@langchain/core** - LangChain core library

### Model Provider Integration
- **@langchain/anthropic** - Anthropic Claude model support
- **@langchain/openai** - OpenAI compatible interface
- **@langchain/ollama** - Ollama local/cloud LLM service
- **ollama** - Ollama Node.js client
- **@openrouter/sdk** - OpenRouter API support

### Tools and Utilities
- **Winston** - Structured logging system
- **Zod** - Runtime type validation
- **Zod-to-JSON-Schema** - JSON Schema generation
- **@vscode/ripgrep** - High-performance text search
- **glob** - File pattern matching
- **iconv-lite** - Character encoding conversion
- **commander** - CLI command parsing
- **dotenv** - Environment variable management

### Development Tools
- **Bun** - Fast JavaScript runtime and package manager
- **tsx** - TypeScript direct execution
- **chalk** - Terminal colored output
- **marked** + **highlight.js** - Markdown rendering and code highlighting
- **marked-terminal** - Markdown rendering in terminal

## Architecture

### LangGraph State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Input                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       LangGraph StateGraph                      │
│                                                                 │
│  ┌─────────┐        ┌──────────────┐        ┌───────────────┐  │
│  │  START  │───────▶│    Agent     │───────▶│  Should       │  │
│  └─────────┘        │   (LLM)      │        │  Continue?    │  │
│                     └──────────────┘        └───────┬───────┘  │
│                            ▲                        │          │
│                            │          ┌─────────────┼──────┐   │
│                            │          │             │      │   │
│                            │          ▼             ▼      ▼   │
│                   ┌────────────────────┐    ┌──────────┐ ┌───┐ │
│                   │   Tool Execution   │    │ Confirm  │ │END│ │
│                   │  (Bash/Read/etc.)  │    │  Tools   │ └───┘ │
│                   └────────┬───────────┘    └────┬─────┘       │
│                            │                     │ interrupt   │
│                            │                     │ (y/n)       │
│                            ▼                     │             │
│                   ┌────────────────────┐         │             │
│                   │   Check Messages   │◀────────┘             │
│                   │  (Token Limit?)    │                       │
│                   └────────┬───────────┘                       │
│                            │                                   │
│              ┌─────────────┴─────────────┐                     │
│              ▼                           ▼                     │
│     ┌────────────────┐              ┌─────────┐                │
│     │   Summarize    │              │  Agent  │                │
│     │  (LLM Summary) │─────────────▶│         │                │
│     └────────────────┘              └─────────┘                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Event-Driven Communication

Agent emits events via `AgentEventEmitter`, UI layer subscribes via `useAgentEvents` hook:

| Event Type | Description |
|------------|-------------|
| `thinking` | LLM is processing |
| `streaming` | Streaming response content |
| `tool_use` | Tool call started |
| `tool_result` | Tool execution completed |
| `response` | Final response ready |
| `confirm_required` | Sensitive tool needs confirmation |
| `error` | Error occurred |
| `done` | Request completed |

### Smart Memory Management

The project implements intelligent message history management to solve context window overflow in long conversations:

1. **Token Counting**: Heuristic algorithm for estimating token count in mixed Chinese/English text
2. **Auto Trimming**: Automatically trims early messages when history reaches 70% of context window
3. **Smart Summarization**: Uses LLM to generate summaries of trimmed history, preserving key information
4. **Model Adaptation**: Dynamically adjusts strategy based on different model context windows (8K~200K)

```typescript
// Token estimation rules
// - Chinese: ~1.5 chars/token
// - English: ~4 chars/token
// - Tool calls: Additional parameter and format overhead
```

### Context Injection System

Intelligent context injection mechanism that automatically reads and injects relevant instructions:

1. **CLAUDE.md Support**: Automatically reads project-level or user-level CLAUDE.md files
2. **Task List Sync**: Real-time sync of TodoWrite tool generated task lists
3. **System Reminders**: Automatically generates system reminders based on tool call results
4. **Priority Management**: Different context types injected by priority order

### Task Management Integration

Built-in TodoWrite tool provides complete task management functionality:

- **Status Tracking**: pending, in_progress, completed states
- **Real-time Updates**: Task status changes auto-sync to conversation context
- **Progress Management**: Support for task breakdown and progress display
- **Smart Hints**: Provides task management suggestions at appropriate times

### Web Search & Fetch

Built-in WebSearch and WebFetch tools for real-time web information retrieval:

```
> Search for latest React 19 features

● WebSearch(query="React 19 new features 2024")

Found 10 search results:
1. React 19 - Official Documentation
2. What's New in React 19...
...

> Get detailed content from this article

● WebFetch(url="https://react.dev/blog/...", prompt="Summarize React 19 main features")

React 19 main features include:
1. Actions - Simplified form submission and data mutations...
```

**Features**:
- Uses DuckDuckGo search, no API key required
- Automatically converts web content to Markdown
- Uses current model to analyze web content
- Built-in rate limiting (20 requests/minute)

### IP Geolocation

Location tool supports IP-based geolocation, optimized for both China and international users:

```
> What's the weather like today?

● Location()

Current location (based on IP):
- City: Beijing
- Region: Beijing
- Country: China (CN)
- Timezone: Asia/Shanghai

● WebSearch(query="Beijing weather today")

Beijing weather today: Sunny, 15-25°C...
```

**Features**:
- 6 API providers with auto fallback (pconline, ip-api.com, ip.sb, ipwhois.app, ipapi.co, ipinfo.io)
- Results cached for 30 minutes
- Optimized for China network environment

### Persistent Shell

PersistentShell provides persistent shell sessions across commands:

- **State Preservation**: Environment variables and working directory persist across commands
- **Cross-Platform**: macOS, Linux, Windows (Git Bash/WSL)
- **Interrupt Support**: Interrupt running commands via AbortSignal
- **Real-time Output**: Supports streaming output callbacks

### Smart Permission System

Intelligent permission management system:

```typescript
// Safe commands (no confirmation needed)
const SAFE_COMMANDS = ["git status", "git diff", "pwd", "ls", ...];

// Command prefix matching
// "npm install ..." → only need to confirm "npm:*" permission once
const prefixTools = ["npm", "yarn", "bun", "git", "docker", ...];
```

**Permission Modes**:
- `default`: Sensitive tools need confirmation
- `acceptEdits`: Auto-allow Edit/Write operations
- `bypassPermissions`: Skip all permission checks (use with caution)

**Session Permissions**:
- Directory-level write/edit permissions
- Auto-cleared when session ends

### System Reminder Service

Context-aware reminder system that injects hints at appropriate times:

| Reminder Type | Trigger | Priority |
|---------------|---------|----------|
| Task Reminder | Todo list empty or updated | Medium |
| Security Reminder | First file access | High |
| Performance Reminder | Session > 30 minutes | Low |

### Clipboard Image Support

Support for pasting images from clipboard on macOS:

```
> [Paste screenshot]

Detected image in clipboard (256 KB)
Analyzing image content...

This is a code screenshot showing a React component...
```

**Usage**:
1. Use `Cmd + Ctrl + Shift + 4` to capture screenshot to clipboard
2. Paste in YTerm

## Development

### Development Environment Setup

```bash
# Install dependencies
bun install

# Type check
bun run typecheck

# Run tests
bun test
```

### Build and Run

```bash
# Development mode (recommended) - run TypeScript directly
bun start

# Build TypeScript to dist/ directory
bun run build

# Run built code (requires build first)
node dist/cli.js

# Interactive mode example
yterm -m qwen3:4b "Hello"

# Single conversation mode
yterm --prompt "List current directory"
```

### Project Configuration

#### Priority Order
1. **CLI Arguments** (`-m`, `--list`, etc.)
2. **User Settings** (`~/.yterm/settings.json`) - Highest priority
3. **Environment Variables** (`.env.local`, `.env`)
4. **Default Configuration**

#### Configuration File Locations
- **User Settings**: `~/.yterm/settings.json`
- **Environment Variables**: `.env.local` > `.env` > project root `.env`

### Debugging and Logging

#### Logging System
- **Log Levels**: `error`, `warn`, `info`, `debug`
- **Log Files**: `logs/` directory, organized by session
- **Real-time Logging**: Console output and file recording simultaneously

#### Enable Detailed Logging
```bash
# Specify log level at runtime
LOG_LEVEL=debug yterm

# Or set in .env file
LOG_LEVEL=debug
```

### Extension Development

#### Adding a New Tool

1. Create tool file in `src/core/tools/` directory
2. Define parameter schema using Zod
3. Create tool using `tool` function from `@langchain/core/tools`
4. Export from `src/core/tools/index.ts`

Example tool structure:
```typescript
import { z } from "zod";
import { tool } from "@langchain/core/tools";

export const MyTool = tool({
  name: "my_tool",
  description: "Describe tool functionality",
  schema: z.object({
    // Parameter definitions
  }),
  handler: async (input) => {
    // Tool logic
    return result;
  },
});
```

#### Adding a New Model Provider

1. **Configuration**: Add provider settings in `src/core/settings.ts`
2. **Service**: Create API client in `src/core/services/` directory
3. **Model Factory**: Add model creation logic in `src/core/agent/models.ts`
4. **Config Management**: Integrate new provider in `src/core/config.ts`

#### Custom Context Injection

1. Modify `src/core/context/index.ts`
2. Add new context type in `collectContextItems` function
3. Set appropriate priority and generation logic

### Code Standards

- **Module System**: Use ESM modules (`.js` extension in imports)
- **Type Safety**: Complete TypeScript type coverage
- **Error Handling**: Unified error handling and logging
- **Event-Driven**: Agent and UI layers communicate via events

## FAQ

### Q: How to switch models?

A: Three ways:
```bash
# 1. Command line argument
yterm -m claude-3-5-sonnet

# 2. Interactive command
/model claude-3-5-sonnet

# 3. Edit settings file
# Edit ~/.yterm/settings.json
```

### Q: How to switch model providers?

A: Via settings file or environment variables:
```bash
# Interactive reconfiguration
# Will prompt on first run

# Or edit settings file
~/.yterm/settings.json

# Or use environment variable
USE_PROVIDER=ANTHROPIC
```

### Q: What's the difference between local and cloud models?

A:
- **Local Models (Ollama)**:
  - Run locally via Ollama
  - No network connection needed, fast response
  - Good privacy, data stays local
  - Requires local storage space

- **Cloud Models (OpenAI/Anthropic/OpenRouter)**:
  - Requires network connection
  - Stronger model capabilities, usually larger context
  - No local storage needed
  - Requires API key and potential costs

### Q: Model list shows empty or incomplete?

A:
```bash
# Refresh model list
yterm --list

# Check network connection (for cloud models)
# Check Ollama service status (for local models)
ollama list
```

### Q: How to view detailed execution logs?

A:
```bash
# Enable debug logging
LOG_LEVEL=debug yterm

# Log file location
logs/  # Session-organized log files
```

### Q: Which file operations are supported?

A: Full file system operations:
- **File Read/Write**: Read/Write tools
- **File Editing**: Edit tool (string replacement)
- **Directory Operations**: LS tool
- **File Search**: Glob/Grep tools
- **Command Execution**: Bash tool

### Q: Do tool executions require confirmation?

A: By default, sensitive tools (Bash, Write, Edit) request confirmation. You can:
- Enter `y` to confirm or `n` to cancel at the prompt
- Set trust mode (future version feature)

### Q: How to manage long conversations?

A: System manages automatically:
- **Token Counting**: Real-time monitoring of conversation length
- **Auto Trimming**: Auto-compress history when approaching context limit
- **Smart Summarization**: Use AI to summarize history, preserve key info
- **Manual Compression**: Use `/compact` command to proactively compress

### Q: How to backup and restore settings?

A:
```bash
# Settings file location
~/.yterm/settings.json

# Backup settings
cp ~/.yterm/settings.json settings-backup.json

# Restore settings
cp settings-backup.json ~/.yterm/settings.json
```

### Q: Which programming languages are supported?

A: Through Grep and tool integration, syntax highlighting and search for all languages is supported.

## License

ISC

## Author

**HeiSir** <heisir21@163.com>

- GitHub: [@HeiSir2014](https://github.com/HeiSir2014)
- Project: [hello-langchain](https://github.com/HeiSir2014/hello-langchain)

## Contributing

Issues and Pull Requests welcome!

### Development Guide

1. Fork this repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push branch: `git push origin feature/amazing-feature`
5. Create Pull Request

### Code Standards

- Use TypeScript for type-safe development
- Follow ESLint and Prettier configuration
- Add appropriate test cases
- Update relevant documentation

## Changelog

### v1.1.0
- **3 New Tools**: WebSearch, WebFetch, Location
- **Web Search**: DuckDuckGo search, no API key required
- **Web Fetch**: Fetch web content with AI analysis
- **IP Geolocation**: 6 API providers with auto fallback, optimized for China
- **Persistent Shell**: PersistentShell maintains state across commands
- **Smart Permission System**: Command prefix matching, session-level permissions
- **System Reminder Service**: Task/security/performance reminders
- **Clipboard Image Paste**: macOS support
- **Large Output Handling**: Auto write to temp file when > 30KB
- **Tool Metadata System**: Support concurrent execution of read-only tools
- Refactored project architecture, extended multi-model support

### v1.0.0
- Initial release
- LangGraph-based state machine architecture with StateGraph, MemorySaver, and interrupt
- React 19 + Ink 6 terminal UI with Markdown rendering and code highlighting
- Multi-model provider support (Ollama, OpenRouter, OpenAI, Anthropic)
- 10 built-in tools (Bash, BashOutput, KillShell, Read, Write, Edit, Glob, Grep, LS, TodoWrite)
- Smart memory management: Token counting, auto-trim, LLM-driven history summarization
- Event-driven Agent-UI communication architecture
- Persistent user settings (~/.yterm/settings.json)
- Winston logging system, organized by session
- Dynamic model discovery and caching
- Sensitive tool confirmation (using LangGraph interrupt)
- Request interrupt support (AbortController)
- Context injection system (CLAUDE.md, TodoWrite)
- Slash command system (/help, /clear, /model, /compact)

### Architecture Highlights

- **Event-Driven Communication**: Agent and UI layers decoupled via EventEmitter
- **Smart Model Management**: Dynamic model discovery, caching, and auto-configuration
- **Memory Optimization**: Smart token counting, auto-trim, LLM-driven history summarization
- **Modular Design**: Clear core/ui layer separation, easy to extend
- **Type Safety**: TypeScript + Zod runtime validation
- **Smart Permission System**: Safe command whitelist, prefix matching, session permissions
- **Multi-API Fallback**: Resilient design pattern demonstrated by Location tool
