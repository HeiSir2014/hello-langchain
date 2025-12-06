# YTerm

中文 | [English](./README_EN.md)

YTerm 是一个基于 LangGraph 的 AI 终端助手，提供 React/Ink 终端 UI，支持多种 LLM 提供商的工具调用功能。

## 功能特性

- **LangGraph 状态机**：使用 LangGraph 构建对话流程，支持条件分支、状态持久化和中断恢复
- **React/Ink 终端 UI**：现代化的终端用户界面，支持彩色输出、Markdown 渲染和交互式组件
- **多模型提供商支持**：支持 Ollama、OpenRouter、OpenAI、Anthropic 四大模型提供商
- **本地 + 云端模型**：支持本地部署和云端 API，动态模型发现和缓存
- **工具调用 (Tool Calling)**：内置 10 个实用工具，支持文件操作、命令执行、内容搜索、任务管理等
- **智能内存管理**：自动 Token 计数、消息裁剪和 LLM 驱动的历史总结，支持超长对话
- **事件驱动架构**：Agent 与 UI 层通过 EventEmitter 解耦通信
- **工具确认机制**：敏感工具（Bash/Write/Edit）执行前需用户确认，使用 LangGraph interrupt 实现
- **完善的日志系统**：使用 Winston 记录详细的执行日志，按会话组织
- **持久化设置**：用户设置持久化存储在 `~/.yterm/settings.json`
- **任务管理集成**：内置 TodoWrite 工具，支持任务列表管理和进度跟踪
- **上下文注入**：自动读取并注入 CLAUDE.md 文件内容，提供项目级指令
- **请求中断支持**：支持通过 AbortController 中断正在执行的请求
- **网页搜索与抓取**：内置 WebSearch 和 WebFetch 工具，支持实时网络信息检索
- **IP 地理定位**：Location 工具支持多 API 回退的 IP 定位，针对中国和国际用户优化
- **持久化 Shell**：PersistentShell 维持会话状态，支持 macOS/Linux/Windows（Git Bash/WSL）
- **智能权限系统**：智能权限管理，支持命令前缀匹配和会话级权限
- **系统提醒服务**：上下文感知的提醒系统，包含任务、安全和性能提示
- **剪贴板图片粘贴**：支持从剪贴板粘贴图片（macOS）
- **大输出处理**：自动将超大输出写入临时文件，避免内存溢出

## 内置工具

| 工具名 | 描述 | 类型 |
|--------|------|------|
| `Bash` | 执行 shell 命令（支持后台执行） | 敏感 |
| `BashOutput` | 获取后台 shell 的输出 | 只读 |
| `KillShell` | 终止运行中的后台 shell | - |
| `Read` | 读取文件内容（带行号） | 只读 |
| `Write` | 写入文件内容 | 敏感 |
| `Edit` | 编辑文件（字符串替换） | 敏感 |
| `Glob` | 文件模式匹配搜索（如 `**/*.ts`） | 只读 |
| `Grep` | 在文件内容中搜索文本（基于 ripgrep） | 只读 |
| `LS` | 列出目录内容 | 只读 |
| `TodoWrite` | 任务列表管理，支持进度跟踪和状态更新 | - |
| `WebSearch` | 使用 DuckDuckGo 搜索网页 | 只读 |
| `WebFetch` | 获取并分析网页内容 | 只读 |
| `Location` | 基于 IP 地址获取当前位置 | 只读 |

**工具类型说明**：
- **只读**：安全的只读操作，支持并发执行
- **敏感**：需要用户确认才能执行
- **-**：普通工具，不需要确认

## 支持的模型

### 模型提供商

#### Ollama (本地 + 云端)
- **本地模型**：通过 Ollama API 动态发现已安装的模型
- **云端模型**：通过 Ollama Cloud API 访问云端模型
- **特性**：模型缓存、智能发现、支持工具调用检测

#### OpenRouter
- **特性**：动态获取 OpenRouter 可用模型列表
- **优势**：一个 API 访问多个模型提供商

#### OpenAI
- **配置**：使用单一模型配置（根据环境变量）
- **默认模型**：gpt-4o
- **特性**：完整的工具调用支持

#### Anthropic
- **配置**：使用单一模型配置（根据环境变量）
- **默认模型**：claude-sonnet-4-20250514
- **特性**：完整的工具调用支持

### 查看可用模型

```bash
# 列出所有可用模型（需要网络连接获取最新列表）
yterm --list

# 交互式模式下使用命令
/list
```

### 模型选择优先级

1. **CLI 参数**：`-m, --model <name>`
2. **设置文件**：`~/.yterm/settings.json`
3. **环境变量**：`.env.local` 或 `.env`
4. **默认值**：根据当前提供商设置

## 快速开始

### 环境要求

- **Node.js**: 18+ (推荐使用 [Bun](https://bun.sh/) 以获得最佳性能)
- **[Ollama](https://ollama.ai/)**: 本地模型运行（可选）
- **包管理器**: Bun (推荐) 或 npm

### 安装

```bash
# 克隆项目
git clone git@github.com:HeiSir2014/hello-langchain.git
cd hello-langchain

# 安装依赖（使用 Bun）
bun install

# 或使用 npm
npm install
```

### 配置

#### 方式 1：环境变量文件（`.env` 或 `.env.local`）

```env
# 选择模型提供商
USE_PROVIDER=OLLAMA

# Ollama 配置
OLLAMA_MODEL_NAME=qwen3:4b
OLLAMA_HOST=http://localhost:11434
OLLAMA_CLOUD_HOST=https://ollama.com
OLLAMA_CLOUD_API_KEY=your_ollama_cloud_key

# OpenRouter 配置
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL_NAME=x-ai/grok-2-1212
OPENROUTER_MODEL_CONTEXT_LENGTH=131072

# OpenAI 配置
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL_NAME=gpt-4o
OPENAI_MODEL_CONTEXT_LENGTH=128000
OPENAI_BASE_URL=https://api.openai.com/v1

# Anthropic 配置
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL_NAME=claude-sonnet-4-20250514
ANTHROPIC_MODEL_CONTEXT_LENGTH=200000
ANTHROPIC_BASE_URL=https://api.anthropic.com

# 日志级别
LOG_LEVEL=info
```

#### 方式 2：交互式设置（推荐）

首次运行时，系统会提示您进行设置。设置会保存在 `~/.yterm/settings.json` 中。

### 构建和运行

#### 方式 1：全局安装（推荐）

```bash
# 构建项目
bun run build

# 全局安装
bun install -g .

# 使用 YTerm 命令
yterm

# 查看所有可用模型
yterm --list

# 查看帮助
yterm --help

# 使用指定模型运行单次对话
yterm -m claude-3-5-sonnet "解释什么是 LangGraph"
```

#### 方式 2：本地运行

```bash
# 开发模式（推荐）- 直接运行 TypeScript，无需编译
bun start

# 或者使用构建后的代码
bun run build
node dist/cli.js
```

### 首次运行

```bash
# 启动 YTerm（会提示配置设置）
yterm

# 或查看可用模型
yterm --list
```

## 使用说明

### 交互式命令

| 命令 | 描述 |
|------|------|
| `/help`, `/h` | 显示帮助信息 |
| `/clear`, `/c` | 清除对话历史 |
| `/compact` | 压缩对话历史（保留重要信息） |
| `/model`, `/m` | 显示/切换模型 |
| `/exit`, `/quit` | 退出程序 |

### 基础使用

1. **启动 YTerm**：`yterm`
2. **输入消息**：直接在终端输入您的问题或指令
3. **使用工具**：模型会自动调用需要的工具（如文件读取、命令执行等）
4. **确认敏感操作**：对于 Bash、Write、Edit 等敏感工具，系统会请求确认

### 工具调用流程

```
用户输入 → 模型分析 → 工具调用 → 执行结果 → 模型响应
```

当模型需要使用工具时，会显示：
- ● 正在思考... (模型处理中)
- ● 工具名称 (工具调用中)
- ● 最终响应 (工具执行完成)

### 使用示例

#### 基础文件操作

```
> 列出当前目录的文件

● 正在思考...

● LS(path=.)

当前目录包含以下文件和文件夹：
- src/                    # 源代码目录
- logs/                   # 日志文件目录
- node_modules/           # 依赖包目录
- package.json            # 项目配置
- tsconfig.json           # TypeScript 配置
- README.md               # 项目文档
- .env.example            # 环境变量示例
```

#### 工具调用示例

```
> 查看 package.json 文件内容

● 正在思考...

● Read(file_path=package.json)

● package.json 内容：
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

#### 任务管理示例

```
> 我需要完成一个项目，包括需求分析、设计、开发、测试四个阶段

● 正在思考...

● TodoWrite

任务列表已创建：
1. ○ 需求分析 [pending]
2. ○ 系统设计 [pending]  
3. ○ 功能开发 [pending]
4. ○ 测试验收 [pending]
```

#### 多模型切换示例

```
> /model gpt-4o
已切换到 GPT-4o 模型

> 解释什么是 LangGraph

● 正在思考...

LangGraph 是 LangChain生态系统中的一个框架，用于构建多Agent应用程序...
```

#### Bash 命令示例

```
> 运行 `ls -la` 命令

● 正在思考...

● Bash(command="ls -la", run_in_background=false)

total 24
drwxr-xr-x  5 user  staff   160 Dec  6 10:00 .
drwxr-xr-x  3 user  staff    96 Dec  6 09:30 ..
-rw-r--r--  1 user  staff  1024 Dec  6 10:00 README.md
-rw-r--r--  1 user  staff   512 Dec  6 09:45 package.json
```

## 项目结构

```
hello-langchain/
├── src/
│   ├── cli.tsx                 # 入口点 - Commander CLI + Ink 渲染
│   ├── logger.ts               # Winston 日志系统
│   ├── core/
│   │   ├── config.ts           # 模型定义、提供商配置、环境变量加载
│   │   ├── settings.ts         # 持久化设置 (~/.yterm/settings.json)
│   │   ├── agent/
│   │   │   ├── index.ts        # LangGraph StateGraph (agent, tools, confirm, summarize 节点)
│   │   │   ├── models.ts       # 所有提供商的统一聊天模型工厂
│   │   │   ├── memory.ts       # Token 计数、消息裁剪、总结
│   │   │   └── events.ts       # AgentEventEmitter 用于 UI 通信
│   │   ├── context/
│   │   │   └── index.ts        # 上下文注入 (CLAUDE.md, todo 列表)
│   │   ├── services/
│   │   │   ├── ollama.ts       # Ollama API 客户端与模型缓存
│   │   │   ├── openai.ts       # OpenAI API 服务
│   │   │   ├── anthropic.ts    # Anthropic API 服务
│   │   │   ├── openrouter.ts   # OpenRouter API 服务
│   │   │   └── reminder.ts     # 系统提醒服务（任务/安全/性能提示）
│   │   ├── utils/
│   │   │   ├── PersistentShell.ts  # 持久化 Shell 会话管理
│   │   │   └── output.ts       # 输出工具（大输出处理）
│   │   ├── permissions.ts      # 权限系统
│   │   └── tools/
│   │       ├── index.ts        # 工具导出和描述
│   │       ├── types.ts        # 工具元数据和类型定义
│   │       ├── bash.ts         # Bash, BashOutput, KillShell 工具
│   │       ├── file.ts         # Read, Write, Edit, Glob, Grep, LS 工具
│   │       ├── todo.ts         # TodoWrite 任务管理工具
│   │       ├── web.ts          # WebSearch, WebFetch 网页工具
│   │       └── location.ts     # Location IP 地理定位工具
│   └── ui/
│       ├── app.tsx             # 根组件，ThemeProvider
│       ├── screens/
│       │   └── REPL.tsx        # 主要 REPL 屏幕，消息处理
│       ├── components/
│       │   ├── Message.tsx     # 消息包装组件
│       │   ├── Spinner.tsx     # 加载动画
│       │   ├── PromptInput.tsx # 用户输入组件
│       │   ├── Logo.tsx        # YTerm Logo 显示
│       │   ├── Help.tsx        # 帮助信息显示
│       │   ├── ModelConfig.tsx # 模型配置 UI
│       │   ├── messages/       # 消息类型组件
│       │   └── permissions/    # 权限请求组件
│       ├── commands/           # 斜杠命令 (/clear, /help, /model, /compact)
│       ├── hooks/              # React hooks (useAgentEvents, useTerminalSize 等)
│       ├── utils/
│       │   ├── theme.ts        # 颜色主题定义
│       │   ├── markdown.ts     # Markdown 渲染
│       │   ├── terminal.ts     # 终端工具
│       │   ├── bash.ts         # Bash 输出格式化
│       │   ├── externalEditor.ts # 外部编辑器支持
│       │   └── imagePaste.ts   # 剪贴板图片粘贴（macOS）
│       └── types/              # TypeScript 类型定义
├── logs/                       # 会话日志文件
├── ~/.yterm/                   # 用户设置目录
│   └── settings.json           # 持久化设置
├── package.json
├── tsconfig.json
├── CLAUDE.md                   # Claude Code 开发指南
└── README.md
```

## 技术栈

### 核心框架
- **TypeScript** - 类型安全的开发体验
- **React 19** + **Ink 6** - 终端 UI 框架
- **LangGraph** - 对话状态机和流程控制
- **@langchain/core** - LangChain 核心库

### 模型提供商集成
- **@langchain/anthropic** - Anthropic Claude 模型支持
- **@langchain/openai** - OpenAI 兼容接口
- **@langchain/ollama** - Ollama 本地/云端 LLM 服务
- **ollama** - Ollama Node.js 客户端
- **@openrouter/sdk** - OpenRouter API 支持

### 工具和实用程序
- **Winston** - 结构化日志系统
- **Zod** - 运行时类型校验
- **Zod-to-JSON-Schema** - JSON Schema 生成
- **@vscode/ripgrep** - 高性能文本搜索
- **glob** - 文件模式匹配
- **iconv-lite** - 字符编码转换
- **commander** - CLI 命令解析
- **dotenv** - 环境变量管理

### 开发工具
- **Bun** - 快速的 JavaScript 运行时和包管理器
- **tsx** - TypeScript 直接执行
- **chalk** - 终端彩色输出
- **marked** + **highlight.js** - Markdown 渲染和代码高亮
- **marked-terminal** - 终端中的 Markdown 渲染

## 架构说明

### LangGraph 状态机

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
│     │   (LLM 总结)   │─────────────▶│         │                │
│     └────────────────┘              └─────────┘                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 事件驱动通信

Agent 通过 `AgentEventEmitter` 发射事件，UI 层通过 `useAgentEvents` hook 订阅：

| 事件类型 | 描述 |
|----------|------|
| `thinking` | LLM 正在处理 |
| `streaming` | 流式响应内容 |
| `tool_use` | 工具调用开始 |
| `tool_result` | 工具执行完成 |
| `response` | 最终响应就绪 |
| `confirm_required` | 敏感工具需要确认 |
| `error` | 发生错误 |
| `done` | 请求完成 |

### 智能内存管理

项目实现了智能的消息历史管理机制，解决了长对话中上下文窗口溢出的问题：

1. **Token 计数**：使用启发式算法估算中英文混合文本的 token 数量
2. **自动裁剪**：当消息历史达到上下文窗口的 70% 时，自动裁剪早期消息
3. **智能总结**：使用 LLM 对被裁剪的历史消息生成摘要，保留关键信息
4. **按模型适配**：根据不同模型的上下文窗口大小（8K~200K）动态调整策略

```typescript
// Token 估算规则
// - 中文：约 1.5 字符/token
// - 英文：约 4 字符/token
// - 工具调用：额外计入参数和格式开销
```

### 上下文注入系统

项目实现了智能的上下文注入机制，自动读取并注入相关指令：

1. **CLAUDE.md 支持**：自动读取项目级或用户级 CLAUDE.md 文件
2. **任务列表同步**：实时同步 TodoWrite 工具生成的任务列表
3. **系统提醒**：根据工具调用结果自动生成相应的系统提醒
4. **优先级管理**：不同类型上下文按优先级排序注入

### 任务管理集成

内置 TodoWrite 工具，提供完整的任务管理功能：

- **状态跟踪**：pending、in_progress、completed 三种状态
- **实时更新**：任务状态变更时自动同步到对话上下文
- **进度管理**：支持任务分解和进度展示
- **智能提示**：在适当时机提供任务管理建议

### 网页搜索与抓取

内置 WebSearch 和 WebFetch 工具，支持实时网络信息检索：

```
> 搜索最新的 React 19 新特性

● WebSearch(query="React 19 new features 2024")

找到 10 条搜索结果：
1. React 19 - Official Documentation
2. What's New in React 19...
...

> 获取这篇文章的详细内容

● WebFetch(url="https://react.dev/blog/...", prompt="总结 React 19 的主要新特性")

React 19 的主要新特性包括：
1. Actions - 简化表单提交和数据变更...
```

**特性**：
- 使用 DuckDuckGo 搜索，无需 API 密钥
- 自动将网页内容转换为 Markdown
- 使用当前模型分析网页内容
- 内置速率限制（20 请求/分钟）

### IP 地理定位

Location 工具支持基于 IP 的地理定位，针对中国和国际用户优化：

```
> 今天天气怎么样？

● Location()

当前位置（基于 IP）：
- 城市：北京
- 区域：北京市
- 国家：中国 (CN)
- 时区：Asia/Shanghai

● WebSearch(query="北京今天天气")

北京今天天气：晴，温度 15-25°C...
```

**特性**：
- 6 个 API 提供商自动回退（pconline、ip-api.com、ip.sb、ipwhois.app、ipapi.co、ipinfo.io）
- 结果缓存 30 分钟
- 针对中国网络环境优化

### 持久化 Shell

PersistentShell 提供跨命令的持久化 Shell 会话：

- **状态保持**：环境变量、工作目录在命令间保持
- **跨平台支持**：macOS、Linux、Windows（Git Bash/WSL）
- **中断支持**：通过 AbortSignal 中断运行中的命令
- **实时输出**：支持流式输出回调

### 智能权限系统

智能权限管理系统：

```typescript
// 安全命令无需确认
const SAFE_COMMANDS = ["git status", "git diff", "pwd", "ls", ...];

// 命令前缀匹配
// "npm install ..." → 只需确认一次 "npm:*" 权限
const prefixTools = ["npm", "yarn", "bun", "git", "docker", ...];
```

**权限模式**：
- `default`：敏感工具需要确认
- `acceptEdits`：自动允许 Edit/Write 操作
- `bypassPermissions`：跳过所有权限检查（谨慎使用）

**会话权限**：
- 目录级别的写入/编辑权限
- 会话结束后自动清除

### 系统提醒服务

上下文感知的提醒系统，在适当时机注入提示：

| 提醒类型 | 触发条件 | 优先级 |
|----------|----------|--------|
| 任务提醒 | Todo 列表为空或更新 | 中 |
| 安全提醒 | 首次文件访问 | 高 |
| 性能提醒 | 会话超过 30 分钟 | 低 |

### 剪贴板图片支持

在 macOS 上支持从剪贴板粘贴图片：

```
> [粘贴截图]

已检测到剪贴板中的图片 (256 KB)
正在分析图片内容...

这是一张代码截图，显示的是一个 React 组件...
```

**使用方法**：
1. 使用 `Cmd + Ctrl + Shift + 4` 截图到剪贴板
2. 在 YTerm 中粘贴

## 开发

### 开发环境设置

```bash
# 安装依赖
bun install

# 类型检查
bun run typecheck

# 运行测试
bun test
```

### 构建和运行

```bash
# 开发模式（推荐）- 直接运行 TypeScript，无需编译
bun start

# 构建 TypeScript 到 dist/ 目录
bun run build

# 运行构建后的代码（需要先构建）
node dist/cli.js

# 交互式模式示例
yterm -m qwen3:4b "你好"

# 单次对话模式
yterm --prompt "列出当前目录"
```

### 项目配置

#### 优先级顺序
1. **CLI 参数** (`-m`, `--list` 等)
2. **用户设置** (`~/.yterm/settings.json`) - 最高优先级
3. **环境变量** (`.env.local`, `.env`)
4. **默认配置**

#### 配置文件位置
- **用户设置**：`~/.yterm/settings.json`
- **环境变量**：`.env.local` > `.env` > 项目根目录 `.env`

### 调试和日志

#### 日志系统
- **日志级别**：`error`, `warn`, `info`, `debug`
- **日志文件**：`logs/` 目录，按会话组织
- **实时日志**：控制台输出和文件同时记录

#### 启用详细日志
```bash
# 运行时指定日志级别
LOG_LEVEL=debug yterm

# 或在 .env 文件中设置
LOG_LEVEL=debug
```

### 扩展开发

#### 添加新工具

1. 在 `src/core/tools/` 目录下创建工具文件
2. 使用 Zod 定义参数模式
3. 使用 `@langchain/core/tools` 的 `tool` 函数创建工具
4. 在 `src/core/tools/index.ts` 中导出

示例工具结构：
```typescript
import { z } from "zod";
import { tool } from "@langchain/core/tools";

export const MyTool = tool({
  name: "my_tool",
  description: "描述工具功能",
  schema: z.object({
    // 参数定义
  }),
  handler: async (input) => {
    // 工具逻辑
    return result;
  },
});
```

#### 添加新模型提供商

1. **配置**：`src/core/settings.ts` 添加提供商设置
2. **服务**：`src/core/services/` 目录创建 API 客户端
3. **模型工厂**：`src/core/agent/models.ts` 添加模型创建逻辑
4. **配置管理**：`src/core/config.ts` 集成新提供商

#### 自定义上下文注入

1. 修改 `src/core/context/index.ts`
2. 在 `collectContextItems` 函数中添加新的上下文类型
3. 设置合适的优先级和生成逻辑

### 代码规范

- **模块系统**：使用 ESM 模块 (`.js` 扩展名在导入中)
- **类型安全**：完整的 TypeScript 类型覆盖
- **错误处理**：统一的错误处理和日志记录
- **事件驱动**：Agent 和 UI 层通过事件通信

## 常见问题

### Q: 如何切换模型？

A: 有三种方式：
```bash
# 1. 命令行参数
yterm -m claude-3-5-sonnet

# 2. 交互式命令
/model claude-3-5-sonnet

# 3. 修改设置文件
# 编辑 ~/.yterm/settings.json
```

### Q: 如何切换模型提供商？

A: 通过设置文件或环境变量：
```bash
# 交互式重新配置
# 首次运行时会提示配置

# 或编辑设置文件
~/.yterm/settings.json

# 或使用环境变量
USE_PROVIDER=ANTHROPIC
```

### Q: 本地模型和云端模型有什么区别？

A: 
- **本地模型（Ollama）**：
  - 通过 Ollama 在本地运行
  - 无需网络连接，响应快
  - 隐私性好，数据不离开本地
  - 需要本地存储空间
  
- **云端模型（OpenAI/Anthropic/OpenRouter）**：
  - 需要网络连接
  - 模型能力更强，通常支持更大上下文
  - 无需本地存储
  - 需要 API 密钥和可能的费用

### Q: 模型列表显示为空或不完整？

A: 
```bash
# 刷新模型列表
yterm --list

# 检查网络连接（用于云端模型）
# 检查 Ollama 服务状态（用于本地模型）
ollama list
```

### Q: 如何查看详细的执行日志？

A: 
```bash
# 启用 debug 日志
LOG_LEVEL=debug yterm

# 日志文件位置
logs/  # 按会话组织的日志文件
```

### Q: 支持哪些文件操作？

A: 支持完整的文件系统操作：
- **文件读写**：Read/Write 工具
- **文件编辑**：Edit 工具（字符串替换）
- **目录操作**：LS 工具
- **文件搜索**：Glob/Grep 工具
- **命令执行**：Bash 工具

### Q: 工具执行需要确认吗？

A: 默认情况下，敏感工具（Bash、Write、Edit）会请求确认。您可以：
- 在提示时输入 `y` 确认或 `n` 取消
- 设置信任模式（未来版本功能）

### Q: 如何管理长期对话？

A: 系统自动管理：
- **Token 计数**：实时监控对话长度
- **自动裁剪**：当接近上下文限制时自动压缩历史
- **智能总结**：使用 AI 总结历史，保留关键信息
- **手动压缩**：使用 `/compact` 命令主动压缩

### Q: 如何备份和恢复设置？

A: 
```bash
# 设置文件位置
~/.yterm/settings.json

# 备份设置
cp ~/.yterm/settings.json settings-backup.json

# 恢复设置
cp settings-backup.json ~/.yterm/settings.json
```

### Q: 支持哪些编程语言的文件？

A: 通过 Grep 和工具集成，支持所有语言的语法高亮和搜索。

## License

ISC

## 作者

**HeiSir** <heisir21@163.com>

- GitHub: [@HeiSir2014](https://github.com/HeiSir2014)
- 项目地址: [hello-langchain](https://github.com/HeiSir2014/hello-langchain)

## 贡献

欢迎提交 Issue 和 Pull Request！

### 开发指南

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 创建 Pull Request

### 代码规范

- 使用 TypeScript 进行类型安全开发
- 遵循 ESLint 和 Prettier 配置
- 添加适当的测试用例
- 更新相关文档

## 更新日志

### v1.1.0
- **新增 3 个工具**：WebSearch、WebFetch、Location
- **网页搜索**：使用 DuckDuckGo 搜索，无需 API 密钥
- **网页抓取**：获取网页内容并使用 AI 分析
- **IP 地理定位**：6 个 API 提供商自动回退，针对中国优化
- **持久化 Shell**：PersistentShell 跨命令保持状态
- **智能权限系统**：命令前缀匹配，会话级权限
- **系统提醒服务**：任务/安全/性能提醒
- **剪贴板图片粘贴**：macOS 支持
- **大输出处理**：超过 30KB 自动写入临时文件
- **工具元数据系统**：支持并发执行只读工具
- 重构项目架构，扩展多模型支持

### v1.0.0
- 初始版本发布
- 基于 LangGraph 的状态机架构，支持 StateGraph、MemorySaver 和 interrupt
- React 19 + Ink 6 终端 UI，支持 Markdown 渲染和代码高亮
- 多模型提供商支持（Ollama、OpenRouter、OpenAI、Anthropic）
- 内置 10 个实用工具（Bash、BashOutput、KillShell、Read、Write、Edit、Glob、Grep、LS、TodoWrite）
- 智能内存管理：Token 计数、自动裁剪、LLM 驱动的历史总结
- 事件驱动的 Agent-UI 通信架构
- 持久化用户设置（~/.yterm/settings.json）
- Winston 日志系统，按会话组织
- 动态模型发现和缓存
- 敏感工具确认机制（使用 LangGraph interrupt）
- 请求中断支持（AbortController）
- 上下文注入系统（CLAUDE.md、TodoWrite）
- 斜杠命令系统（/help、/clear、/model、/compact）

### 架构亮点

- **事件驱动通信**：Agent 和 UI 层通过 EventEmitter 解耦
- **智能模型管理**：支持动态模型发现、缓存和自动配置
- **内存优化**：智能 Token 计数、自动裁剪和 LLM 驱动的历史总结
- **模块化设计**：清晰的 core/ui 层分离，易于扩展
- **类型安全**：TypeScript + Zod 运行时验证
- **智能权限系统**：安全命令白名单、前缀匹配、会话权限
- **多 API 回退**：Location 工具展示的弹性设计模式
