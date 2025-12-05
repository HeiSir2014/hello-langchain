# Hello LangChain

基于 LangGraph 的交互式 AI Agent，支持多种模型提供商、工具调用、多轮对话和智能内存管理。

## 功能特性

- **LangGraph 状态机**：使用 LangGraph 构建对话流程，支持条件分支和状态持久化
- **多模型提供商支持**：支持 Ollama、OpenRouter、OpenAI、Anthropic 四大模型提供商
- **本地 + 云端模型**：支持本地部署和云端 API，可动态切换
- **工具调用 (Tool Calling)**：内置 8 个实用工具，支持文件操作、命令执行、内容搜索、任务管理等
- **智能内存管理**：自动 Token 计数、消息裁剪和历史总结，支持超长对话
- **流式输出**：实时流式显示模型响应
- **多轮对话**：基于 Checkpointer 实现对话历史持久化
- **工具确认机制**：可选的敏感工具（Bash/Write/Edit）执行前确认
- **完善的日志系统**：使用 Winston 记录详细的执行日志
- **多线程支持**：支持多会话并行，每个线程独立管理对话历史
- **任务管理集成**：内置 TodoWrite 工具，支持任务列表管理和进度跟踪
- **上下文注入**：自动读取并注入 CLAUDE.md 文件内容，提供项目级指令
- **统一模型工厂**：智能缓存和统一接口，支持任意模型名称动态绑定

## 内置工具

| 工具名 | 描述 |
|--------|------|
| `Bash` | 执行 shell 命令（大输出自动保存到临时文件） |
| `Read` | 读取文件内容（支持分页） |
| `Write` | 写入文件内容 |
| `Edit` | 编辑文件（字符串替换） |
| `Glob` | 文件模式匹配搜索（如 `**/*.ts`） |
| `Grep` | 在文件内容中搜索文本（基于 ripgrep） |
| `LS` | 列出目录内容 |
| `TodoWrite` | 任务列表管理，支持进度跟踪和状态更新 |

## 支持的模型

### 本地模型（Ollama）

| 名称 | 模型 | 上下文窗口 | 描述 | 工具调用 |
|------|------|-----------|------|----------|
| `qwen3:4b` | qwen3:4b | 32K | Qwen3 4B - 轻量级 | ✅ |
| `qwen3:8b` | qwen3:8b | 32K | Qwen3 8B | ✅ |
| `qwen3:0.6b` | qwen3:0.6b | 8K | Qwen3 0.6B - 最小 | ❌ |
| `qwen3-coder` | qwen3-coder:latest | 32K | Qwen3 Coder 18GB | ✅ |
| `gemma3:4b` | gemma3:4b | 8K | Gemma3 4B | ❌ |

### Ollama 云端模型

| 名称 | 模型 | 上下文窗口 | 描述 | 工具调用 |
|------|------|-----------|------|----------|
| `gpt-oss` | gpt-oss:120b-cloud | 128K | GPT-OSS 120B - 推理 & Agent | ✅ |
| `qwen3-coder-480b` | qwen3-coder:480b-cloud | 128K | Qwen3 Coder 480B - 编码专用 | ✅ |
| `qwen3-vl` | qwen3-vl:235b-cloud | 160K | Qwen3 VL 235B - 视觉语言 | ✅ |
| `qwen3-vl-instruct` | qwen3-vl:235b-instruct-cloud | 160K | Qwen3 VL Instruct 235B - 视觉语言 | ✅ |
| `deepseek-v3` | deepseek-v3.1:671b-cloud | 160K | DeepSeek V3.1 671B - 思考推理 | ✅ |
| `minimax-m2` | minimax-m2:cloud | 200K | MiniMax M2 Cloud | ✅ |
| `glm-4.6` | glm-4.6:cloud | 198K | GLM 4.6 Cloud | ✅ |

### OpenRouter 模型

| 名称 | 模型 | 上下文窗口 | 描述 | 工具调用 |
|------|------|-----------|------|----------|
| `openrouter` | x-ai/grok-2-1212 | 131K | Grok-2-1212 via OpenRouter | ✅ |

### OpenAI 模型

| 名称 | 模型 | 上下文窗口 | 描述 | 工具调用 |
|------|------|-----------|------|----------|
| `gpt-4o` | gpt-4o | 128K | GPT-4o | ✅ |
| `gpt-4o-mini` | gpt-4o-mini | 128K | GPT-4o Mini | ✅ |
| `gpt-4-turbo` | gpt-4-turbo | 128K | GPT-4 Turbo | ✅ |
| `gpt-3.5-turbo` | gpt-3.5-turbo | 16K | GPT-3.5 Turbo | ✅ |

### Anthropic 模型

| 名称 | 模型 | 上下文窗口 | 描述 | 工具调用 |
|------|------|-----------|------|----------|
| `claude-sonnet` | claude-sonnet-4-20250514 | 200K | Claude Sonnet 4 | ✅ |
| `claude-3-5-sonnet` | claude-3-5-sonnet-20241022 | 200K | Claude 3.5 Sonnet | ✅ |
| `claude-3-opus` | claude-3-opus-20240229 | 200K | Claude 3 Opus | ✅ |
| `claude-3-haiku` | claude-3-haiku-20240307 | 200K | Claude 3 Haiku | ✅ |

## 快速开始

### 环境要求

- Node.js 18+
- [Ollama](https://ollama.ai/) (本地运行)

### 安装

```bash
# 克隆项目
git clone git@github.com:HeiSir2014/hello-langchain.git
cd hello-langchain

# 安装依赖
npm install
```

### 配置

创建 `.env` 或 `.env.local` 文件（可选）：

```env
# 使用的模型提供商 (OLLAMA|OPENROUTER|OPENAI|ANTHROPIC)
USE_PROVIDER=OLLAMA

# Ollama 配置
OLLAMA_HOST=http://localhost:11434
OLLAMA_CLOUD_HOST=https://ollama.com
OLLAMA_CLOUD_API_KEY=your_ollama_cloud_key

# OpenRouter 配置
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL_NAME=x-ai/grok-2-1212
OPENROUTER_MODEL_CONTEXT_LENGTH=131072

# OpenAI 配置
OPENAI_API_KEY=your_openai_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL_NAME=gpt-4o
OPENAI_MODEL_CONTEXT_LENGTH=128000

# Anthropic 配置
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MODEL_NAME=claude-sonnet-4-20250514
ANTHROPIC_MODEL_CONTEXT_LENGTH=200000

# 默认模型（根据 USE_PROVIDER 自动选择）
DEFAULT_MODEL=gpt-oss

# 日志级别 (error|warn|info|debug)
LOG_LEVEL=debug
```

### 运行

```bash
# 交互式模式（默认）
npm start

# 单次对话
npm start -- -m qwen3:4b "列出当前目录的文件"

# 指定模型并启用工具确认
npm start -- -m qwen3:8b --confirm -i

# 查看所有可用模型
npm start -- --list

# 查看帮助
npm start -- --help
```

## 使用说明

### 交互式命令

| 命令 | 描述 |
|------|------|
| `/help`, `/h` | 显示帮助信息 |
| `/list`, `/l` | 列出所有可用模型和配置状态 |
| `/model <名称>` | 切换模型（如 `/model qwen3:4b`） |
| `/tools` | 显示可用工具列表 |
| `/clear`, `/c` | 清除对话历史（创建新线程） |
| `/history` | 显示对话历史 |
| `/thread` | 显示当前线程 ID |
| `/confirm [on\|off]` | 开启/关闭敏感工具确认 |
| `/state` | 显示当前 Graph 状态 |
| `/todo` | 显示当前任务列表 |
| `/exit`, `/quit` | 退出程序 |

### 使用示例

#### 基础文件操作

```
👤 你: 列出当前目录的文件

🔄 模型请求调用 1 个工具:
   1. LS({"path":"."})

📁 [LS]
✅ [LS] 📂 . (8 项)

🤖 [gpt-oss] 当前目录包含以下文件和文件夹：
- 📁 src/
- 📁 logs/
- 📁 node_modules/
- 📄 package.json
- 📄 tsconfig.json
- 📄 README.md
...
```

#### 任务管理示例

```
👤 你: 我需要完成一个项目，包括需求分析、设计、开发、测试四个阶段

🤖 [gpt-oss] 我来帮你创建任务列表：

🔧 [TodoWrite]
✅ [TodoWrite] Todo list updated successfully.
Total: 4 | Pending: 4 | In Progress: 0 | Completed: 0

当前任务:
1. ○ 需求分析 [pending]
2. ○ 系统设计 [pending]  
3. ○ 功能开发 [pending]
4. ○ 测试验收 [pending]
```

#### 上下文注入示例

```
👤 你: 查看我的项目指令

🤖 [gpt-oss] 根据你的 CLAUDE.md 文件，我了解到项目的开发规范：

# claudeMd
Codebase and user instructions are shown below...
项目要求：
- 优先增量开发
- 学习现有代码
- 实用主义优于教条主义
...
```

#### 多模型切换示例

```
👤 你: /model claude-3-5-sonnet
切换到 Claude 3.5 Sonnet 模型

👤 你: 帮我分析这个代码文件

🤖 [claude-3-5-sonnet] 我来帮你分析...
```

## 项目结构

```
hello-langchain/
├── src/
│   ├── index.ts          # 主入口，CLI 交互
│   ├── config.ts         # 配置管理，模型定义
│   ├── logger.ts         # 日志系统 (Winston)
│   ├── ui.ts             # UI 输出模块
│   ├── agent/
│   │   ├── index.ts      # LangGraph 状态机定义
│   │   ├── models.ts     # 统一聊天模型工厂
│   │   └── memory.ts     # 消息内存管理（Token 计数、裁剪、总结）
│   ├── tools/
│   │   ├── index.ts      # 工具导出
│   │   ├── bash.ts       # Bash 命令执行工具
│   │   ├── file.ts       # 文件操作工具集
│   │   └── todo.ts       # 任务管理工具
│   └── context/
│       └── index.ts      # 上下文注入管理
├── logs/                 # 日志目录
├── package.json
├── tsconfig.json
└── README.md
```

## 技术栈

- **TypeScript** - 类型安全
- **LangGraph** - 对话状态机
- **@langchain/core** - LangChain 核心库
- **@langchain/anthropic** - Anthropic Claude 模型支持
- **@langchain/openai** - OpenAI 兼容接口
- **@langchain/ollama** - Ollama 本地/云端 LLM 服务
- **@openrouter/sdk** - OpenRouter API 支持
- **Winston** - 日志系统
- **Zod** - 运行时类型校验
- **@vscode/ripgrep** - 高性能文本搜索
- **glob** - 文件模式匹配
- **iconv-lite** - 字符编码转换

## 架构说明

### LangGraph 状态机

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Input                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       LangGraph                                 │
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
│                            │                     │             │
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

## 开发

### 构建和运行

```bash
# 安装依赖
npm install

# 构建 TypeScript
npm run build

# 开发模式（使用 tsx 直接运行）
npm start

# 生产模式（运行构建后的代码）
npm run build && node dist/index.js
```

### 环境变量配置

#### 本地开发（Ollama）

```env
USE_PROVIDER=OLLAMA
OLLAMA_HOST=http://localhost:11434
DEFAULT_MODEL=qwen3:4b
LOG_LEVEL=debug
```

#### 云端开发（多提供商）

```env
# 选择主要提供商
USE_PROVIDER=ANTHROPIC

# Anthropic 配置
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL_NAME=claude-sonnet-4-20250514

# OpenAI 配置（作为备选）
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL_NAME=gpt-4o

# OpenRouter 配置
OPENROUTER_API_KEY=your_openrouter_key
```

### 调试技巧

1. **启用详细日志**：
   ```env
   LOG_LEVEL=debug
   ```

2. **查看模型调用详情**：
   - 所有 LLM 调用都有详细的日志记录
   - 包括请求参数、响应时间、token 使用量等

3. **工具执行跟踪**：
   - 每个工具调用都有执行时间统计
   - 支持的工具调用会在日志中显示

### 扩展开发

#### 添加新工具

1. 在 `src/tools/` 目录下创建新工具文件
2. 使用 `@langchain/core/tools` 的 `tool` 函数定义
3. 在 `src/tools/index.ts` 中导出
4. 添加相应的 Zod 模式验证

#### 添加新模型提供商

1. 在 `src/config.ts` 中添加提供商配置
2. 在 `src/agent/models.ts` 中实现模型创建逻辑
3. 更新 `USE_PROVIDER` 环境变量支持

#### 自定义上下文注入

1. 修改 `src/context/index.ts` 中的 `collectContextItems` 函数
2. 添加新的上下文类型和优先级
3. 实现相应的生成逻辑

## 常见问题

### Q: 如何切换模型提供商？

A: 修改环境变量 `USE_PROVIDER`：
```env
USE_PROVIDER=ANTHROPIC  # 或 OLLAMA, OPENAI, OPENROUTER
```

### Q: 如何启用工具执行确认？

A: 在交互模式中使用 `/confirm on` 命令，或启动时使用 `--confirm` 参数。

### Q: 本地模型和云端模型有什么区别？

A: 
- **本地模型**：通过 Ollama 在本地运行，无需网络，响应快
- **云端模型**：需要网络连接，模型能力更强，支持更大上下文

### Q: 如何查看详细的执行日志？

A: 设置日志级别为 debug：
```env
LOG_LEVEL=debug
```

### Q: 支持哪些文件操作？

A: 支持完整的文件系统操作：
- 文件读写（Read/Write）
- 文件编辑（Edit）
- 目录操作（LS）
- 文件搜索（Glob/Grep）

### Q: 如何自定义工具？

A: 参考 `src/tools/` 目录下的现有工具实现，使用 `@langchain/core/tools` 的 `tool` 函数定义。

## License

ISC

## Author

**HeiSir** <heisir21@163.com>

- GitHub: [@HeiSir2014](https://github.com/HeiSir2014)

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更新日志

### v1.0.0
- ✨ 初始版本发布
- ✨ 支持 LangGraph 状态机
- ✨ 支持多模型提供商（Ollama、OpenRouter、OpenAI、Anthropic）
- ✨ 内置 8 个实用工具
- ✨ 智能内存管理和上下文注入
- ✨ 任务管理集成
- ✨ 完善的日志系统
