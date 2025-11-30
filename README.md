# Hello LangChain

基于 LangGraph + Ollama 的交互式 AI Agent，支持工具调用（Tool Calling）、多轮对话和智能内存管理。

## 功能特性

- **LangGraph 状态机**：使用 LangGraph 构建对话流程，支持条件分支和状态持久化
- **多模型支持**：支持本地 Ollama 模型和云端模型，可动态切换
- **工具调用 (Tool Calling)**：内置 7 个实用工具，支持文件操作、命令执行、内容搜索等
- **智能内存管理**：自动 Token 计数、消息裁剪和历史总结，支持超长对话
- **流式输出**：实时流式显示模型响应
- **多轮对话**：基于 Checkpointer 实现对话历史持久化
- **工具确认机制**：可选的敏感工具（Bash/Write/Edit）执行前确认
- **完善的日志系统**：使用 Winston 记录详细的执行日志

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

## 支持的模型

### 本地模型（Ollama）

| 名称 | 模型 | 上下文窗口 | 描述 | 工具调用 |
|------|------|-----------|------|----------|
| `qwen3:4b` | qwen3:4b | 32K | Qwen3 4B - 轻量级 | ✅ |
| `qwen3:8b` | qwen3:8b | 32K | Qwen3 8B | ✅ |
| `qwen3:0.6b` | qwen3:0.6b | 8K | Qwen3 0.6B - 最小 | ❌ |
| `qwen3-coder` | qwen3-coder:latest | 32K | Qwen3 Coder 18GB | ✅ |
| `gemma3:4b` | gemma3:4b | 8K | Gemma3 4B | ❌ |

### 云端模型

| 名称 | 模型 | 上下文窗口 | 描述 | 工具调用 |
|------|------|-----------|------|----------|
| `gpt-oss` | gpt-oss:120b-cloud | 128K | GPT-OSS 120B - 推理 & Agent | ✅ |
| `qwen3-coder-480b` | qwen3-coder:480b-cloud | 128K | Qwen3 Coder 480B - 编码专用 | ✅ |
| `qwen3-vl` | qwen3-vl:235b-cloud | 128K | Qwen3 VL 235B - 视觉语言 | ✅ |
| `deepseek-v3` | deepseek-v3.1:671b-cloud | 128K | DeepSeek V3.1 671B - 思考推理 | ✅ |
| `minimax-m2` | minimax-m2:cloud | 64K | MiniMax M2 Cloud | ❌ |
| `glm-4.6` | glm-4.6:cloud | 128K | GLM 4.6 Cloud | ❌ |

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
# Ollama 服务地址（默认 http://localhost:11434）
OLLAMA_HOST=http://localhost:11434

# Ollama API Key（云端模型需要）
OLLAMA_API_KEY=your_api_key

# 默认模型
DEFAULT_MODEL=gpt-oss

# 日志级别
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
| `/list`, `/l` | 列出所有可用模型 |
| `/model <名称>` | 切换模型（如 `/model qwen3:4b`） |
| `/tools` | 显示可用工具列表 |
| `/clear`, `/c` | 清除对话历史（创建新线程） |
| `/history` | 显示对话历史 |
| `/thread` | 显示当前线程 ID |
| `/confirm [on\|off]` | 开启/关闭敏感工具确认 |
| `/state` | 显示当前 Graph 状态 |
| `/exit`, `/quit` | 退出程序 |

### 使用示例

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
│   │   ├── ollama.ts     # Ollama API 调用封装
│   │   └── memory.ts     # 消息内存管理（Token 计数、裁剪、总结）
│   └── tools/
│       ├── index.ts      # 工具导出
│       ├── bash.ts       # Bash 命令执行工具
│       └── file.ts       # 文件操作工具集
├── logs/                 # 日志目录
├── package.json
├── tsconfig.json
└── README.md
```

## 技术栈

- **TypeScript** - 类型安全
- **LangGraph** - 对话状态机
- **@langchain/core** - LangChain 核心库
- **Ollama** - 本地/云端 LLM 服务
- **Winston** - 日志系统
- **Zod** - 运行时类型校验
- **@vscode/ripgrep** - 高性能文本搜索

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
4. **按模型适配**：根据不同模型的上下文窗口大小（8K~128K）动态调整策略

```typescript
// Token 估算规则
// - 中文：约 1.5 字符/token
// - 英文：约 4 字符/token
// - 工具调用：额外计入参数和格式开销
```

## 开发

```bash
# 构建
npm run build

# 开发模式（使用 tsx 直接运行）
npm start
```

## License

ISC

## Author

**HeiSir** <heisir21@163.com>

- GitHub: [@HeiSir2014](https://github.com/HeiSir2014)
