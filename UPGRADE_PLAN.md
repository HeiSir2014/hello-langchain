# YTerm LangChain/LangGraph 升级重构计划

## 一、依赖版本升级

### 当前版本 → 最新版本

| 包名 | 当前版本 | 最新版本 | 变更说明 |
|------|---------|---------|---------|
| `@langchain/core` | ^1.1.8 | ^1.1.34 | 核心库，Store API、改进的工具调用 |
| `@langchain/langgraph` | ^1.0.7 | ^1.2.3 | StateGraph 增强，InMemoryStore，改进的中断机制 |
| `@langchain/anthropic` | ^1.3.3 | ^1.3.25 | Claude 模型更新，改进的 streaming |
| `@langchain/openai` | ^1.2.0 | ^1.3.0 | OpenAI 最新模型支持 |
| `@langchain/ollama` | ^1.1.0 | ^1.2.6 | Ollama 改进 |

### 新增依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| `@langchain/langgraph-supervisor` | ^1.0.1 | Supervisor 多智能体模式 |
| `@langchain/langgraph-swarm` | ^1.0.1 | Swarm 去中心化多智能体模式 |
| `deepagents` | ^1.8.4 | Deep Agents SDK（规划、子代理、文件系统） |
| `@langchain/langgraph-checkpoint` | latest | 检查点持久化抽象 |

---

## 二、架构升级概览

### 当前架构问题

1. **单一 Agent 模式**：主 Agent 承担所有任务，缺乏专业分工
2. **内存仅限会话内**：MemorySaver 仅提供线程内短期记忆，无跨会话长期记忆
3. **子代理简单**：仅有 initAgent 和 planAgent，未形成完整的多代理协作体系
4. **无定时任务**：不支持定期执行或后台轮询任务
5. **工具系统扁平**：所有工具在同一层级，缺乏按智能体分组

### 目标架构

```
┌─────────────────────────────────────────────────────────┐
│                    YTerm CLI (Ink UI)                     │
├─────────────────────────────────────────────────────────┤
│                  Supervisor Agent (协调者)                │
│  ┌──────────┬──────────┬──────────┬──────────────────┐  │
│  │ Coder    │ Researcher│ Planner │ System Monitor   │  │
│  │ Agent    │ Agent     │ Agent   │ Agent (定时任务)  │  │
│  ├──────────┼──────────┼──────────┼──────────────────┤  │
│  │ Write    │ WebSearch│ SavePlan │ HealthCheck      │  │
│  │ Edit     │ WebFetch │ ReadPlan │ ScheduledTask    │  │
│  │ Bash     │ Grep     │ TodoWrite│ BackgroundJob    │  │
│  │ Read     │ Read     │ Read    │ Cron             │  │
│  └──────────┴──────────┴──────────┴──────────────────┘  │
│                         ↕                                │
│  ┌─────────────────────────────────────────────────────┐│
│  │              Memory Layer (跨线程记忆)               ││
│  │  Short-term: MemorySaver (thread checkpoints)       ││
│  │  Long-term:  InMemoryStore → (future: DB-backed)    ││
│  │  Semantic:   Embedding-based memory search          ││
│  └─────────────────────────────────────────────────────┘│
│                         ↕                                │
│  ┌─────────────────────────────────────────────────────┐│
│  │           Scheduler (定时任务引擎)                    ││
│  │  CronManager: 管理定时任务                           ││
│  │  BackgroundTaskQueue: 后台任务队列                   ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

---

## 三、具体实施步骤

### Phase 1: 依赖升级和基础设施 (基础层)

#### Step 1.1: 升级所有 LangChain 依赖
- 更新 `package.json` 中所有 `@langchain/*` 依赖到最新版本
- 新增 `@langchain/langgraph-supervisor`、`@langchain/langgraph-swarm`、`deepagents`
- 运行 `bun install` 并解决版本冲突
- 运行 `bun run typecheck` 确认类型兼容

#### Step 1.2: 修复 Breaking Changes
- 检查 LangGraph ^1.0.7 → ^1.2.3 的 API 变更
- 更新 StateGraph、ToolNode、interrupt() 等 API 调用
- 确保现有功能不受影响

**文件**: `package.json`, `src/core/agent/index.ts`, `src/core/agent/models.ts`

---

### Phase 2: 长期记忆系统 (Memory Layer)

#### Step 2.1: 新增 `src/core/agent/store.ts` - 长期记忆存储

```typescript
// 核心设计
import { InMemoryStore } from "@langchain/langgraph";

// 记忆命名空间设计:
// ["project", projectPath, "context"]    - 项目上下文记忆
// ["project", projectPath, "decisions"]  - 技术决策记忆
// ["project", projectPath, "patterns"]   - 代码模式记忆
// ["user", "preferences"]               - 用户偏好记忆
// ["session", threadId, "summary"]      - 会话摘要
```

#### Step 2.2: 集成 Store 到主 Agent
- 在 `agentNode` 中通过 `runtime.store` 访问长期记忆
- 工具执行结果中重要信息自动存储
- 会话结束时生成摘要并保存到 Store

#### Step 2.3: 新增记忆工具
- `MemorySearch`: 搜索长期记忆
- `MemorySave`: 保存重要信息到长期记忆
- `MemoryList`: 列出某个命名空间下的所有记忆

**文件**: 新增 `src/core/agent/store.ts`, 新增 `src/core/tools/memory.ts`, 修改 `src/core/agent/index.ts`

---

### Phase 3: 多智能体系统 (Multi-Agent)

#### Step 3.1: 新增专业化 Agent 定义 `src/core/agent/agents/`

```
src/core/agent/agents/
├── index.ts          # Agent 注册和导出
├── coderAgent.ts     # 代码编写和修改专家
├── researcherAgent.ts # 研究和信息收集专家
├── plannerAgent.ts   # 规划和任务分解专家 (升级现有 planAgent)
└── monitorAgent.ts   # 系统监控和定时任务代理
```

每个 Agent 使用 `createReactAgent` 创建，配备专用工具集：

- **CoderAgent**: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `LS`
- **ResearcherAgent**: `WebSearch`, `WebFetch`, `Read`, `Glob`, `Grep`, `LS`
- **PlannerAgent**: `Read`, `Glob`, `Grep`, `SavePlan`, `ReadPlan`, `TodoWrite`, `WebSearch`
- **MonitorAgent**: `Bash`, `Read`, `LS`, `ScheduledTask`

#### Step 3.2: Supervisor 协调器 `src/core/agent/supervisor.ts`

```typescript
import { createSupervisor } from "@langchain/langgraph-supervisor";

// Supervisor 决策逻辑:
// 1. 代码修改任务 → CoderAgent
// 2. 信息检索任务 → ResearcherAgent
// 3. 规划/复杂任务 → PlannerAgent
// 4. 定时/监控任务 → MonitorAgent
// 5. 简单对话 → 直接回复
```

#### Step 3.3: Swarm 模式支持 `src/core/agent/swarm.ts`

```typescript
import { createSwarm, createHandoffTool } from "@langchain/langgraph-swarm";

// Swarm 用于更灵活的协作场景:
// Agent 之间可以通过 handoff 工具直接传递控制权
// 适用于需要多个 Agent 协作的复杂任务
```

#### Step 3.4: 集成到主入口
- 修改 `src/core/agent/index.ts`，支持 Supervisor 和 Swarm 两种模式
- 用户可通过设置选择默认模式
- 简单任务仍使用单 Agent，复杂任务自动升级为多 Agent

**文件**: 新增 `src/core/agent/agents/` 目录, 新增 `src/core/agent/supervisor.ts`, 新增 `src/core/agent/swarm.ts`, 修改 `src/core/agent/index.ts`

---

### Phase 4: Deep Agents 集成

#### Step 4.1: 集成 `deepagents` SDK

```typescript
import { createDeepAgent } from "deepagents";

// DeepAgent 用于处理复杂、多步骤任务:
// - 自动任务规划和分解 (write_todos)
// - 子代理生成 (context isolation)
// - 文件系统集成 (上下文外溢管理)
```

#### Step 4.2: 新增 `/deep` 命令
- 触发 Deep Agent 模式处理复杂任务
- 自动规划、分解、执行、验证
- 子代理隔离上下文，防止窗口溢出

#### Step 4.3: Sub-Agent 生成机制
- 主 Agent 可动态生成子代理处理子任务
- 子代理完成后将结果汇报给主 Agent
- 子代理有自己的工具集和上下文限制

**文件**: 新增 `src/core/agent/deepAgent.ts`, 新增 `src/ui/commands/deep.ts`, 修改 `src/ui/commands/index.ts`

---

### Phase 5: 定时任务系统 (Scheduler)

#### Step 5.1: 新增 `src/core/scheduler/` 定时任务引擎

```
src/core/scheduler/
├── index.ts          # Scheduler 导出
├── cronManager.ts    # Cron 定时任务管理器
├── taskQueue.ts      # 后台任务队列
└── types.ts          # 类型定义
```

#### Step 5.2: CronManager 实现

```typescript
// 支持的定时任务类型:
// 1. 定期健康检查 (如 git status, test 状态)
// 2. 定期代码审查提醒
// 3. 定期依赖更新检查
// 4. 自定义用户定时任务

// API 设计:
scheduler.schedule("*/5 * * * *", "health-check", async () => { ... });
scheduler.schedule("0 */1 * * *", "dep-check", async () => { ... });
scheduler.cancel("health-check");
scheduler.list(); // 列出所有活跃任务
```

#### Step 5.3: 后台任务队列

```typescript
// 长时间运行的任务在后台执行:
// - 大型代码库分析
// - 依赖更新检查
// - 测试套件运行
// - 代码质量扫描

taskQueue.enqueue({
  name: "full-test-suite",
  agent: "monitor",
  priority: "low",
  timeout: 300000,
});
```

#### Step 5.4: 新增定时任务相关工具和命令
- `ScheduleTask` 工具: Agent 可以创建定时任务
- `ListTasks` 工具: 列出当前活跃定时任务
- `CancelTask` 工具: 取消定时任务
- `/schedule` 命令: 用户手动管理定时任务

**文件**: 新增 `src/core/scheduler/` 目录, 新增 `src/core/tools/scheduler.ts`, 新增 `src/ui/commands/schedule.ts`

---

### Phase 6: UI 和事件系统更新

#### Step 6.1: 扩展事件系统
新增事件类型:
- `agent_handoff` - Agent 之间控制权转移
- `sub_agent_spawned` - 子代理创建
- `sub_agent_completed` - 子代理完成
- `memory_stored` - 长期记忆保存
- `scheduled_task` - 定时任务触发/完成
- `background_task` - 后台任务进度

#### Step 6.2: UI 组件更新
- `AgentStatusBar`: 显示当前活跃的 Agent 和状态
- `MemoryIndicator`: 显示记忆使用情况
- `SchedulerPanel`: 定时任务面板
- `SubAgentProgress`: 子代理执行进度

#### Step 6.3: 新增 `/agents` 命令
- 列出所有可用 Agent 及其状态
- 显示当前运行模式 (Single/Supervisor/Swarm)
- 支持手动切换运行模式

**文件**: 修改 `src/core/agent/events.ts`, 新增 UI 组件, 新增 `src/ui/commands/agents.ts`

---

### Phase 7: 配置和设置更新

#### Step 7.1: 更新设置系统

```typescript
// ~/.yterm/settings.json 新增字段:
{
  // 多代理配置
  "agentMode": "single" | "supervisor" | "swarm",
  "enableSubAgents": true,

  // 记忆配置
  "memory": {
    "longTermEnabled": true,
    "storePath": "~/.yterm/memory/",
    "maxMemories": 1000,
    "semanticSearchEnabled": false
  },

  // 定时任务配置
  "scheduler": {
    "enabled": true,
    "maxConcurrentTasks": 3,
    "defaultTasks": []
  }
}
```

#### Step 7.2: 更新 CLAUDE.md
- 记录新的架构
- 更新命令和工具列表
- 添加多代理系统使用说明

**文件**: 修改 `src/core/settings.ts`, 修改 `src/core/config.ts`, 修改 `CLAUDE.md`

---

## 四、实施优先级和风险

### 实施顺序

| 优先级 | Phase | 预计影响 | 风险等级 |
|-------|-------|---------|---------|
| P0 | Phase 1: 依赖升级 | 基础，其他均依赖此步 | 低 |
| P1 | Phase 2: 长期记忆 | 高价值，独立性强 | 低 |
| P1 | Phase 3: 多智能体 | 核心升级，价值最高 | 中 |
| P2 | Phase 4: Deep Agents | 增强能力，依赖 Phase 3 | 中 |
| P2 | Phase 5: 定时任务 | 新功能，相对独立 | 低 |
| P3 | Phase 6: UI 更新 | 用户体验，依赖 Phase 2-5 | 低 |
| P3 | Phase 7: 配置更新 | 收尾工作 | 低 |

### 风险控制

1. **向后兼容**: 所有新功能默认关闭，用户可逐步启用
2. **渐进式升级**: 每个 Phase 独立可交付，不需要一次全部完成
3. **单 Agent 回退**: 如果多代理出现问题，可随时回退到单 Agent 模式
4. **类型安全**: 所有新代码使用 TypeScript 严格类型检查
5. **测试覆盖**: 每个 Phase 完成后运行 `bun test` 确保不破坏现有功能

---

## 五、新增文件清单

```
src/core/agent/
├── store.ts              # 长期记忆存储 (Phase 2)
├── supervisor.ts         # Supervisor 多代理协调 (Phase 3)
├── swarm.ts             # Swarm 模式 (Phase 3)
├── deepAgent.ts         # Deep Agents 集成 (Phase 4)
└── agents/
    ├── index.ts          # Agent 注册
    ├── coderAgent.ts     # 编码专家
    ├── researcherAgent.ts # 研究专家
    ├── plannerAgent.ts   # 规划专家
    └── monitorAgent.ts   # 监控代理

src/core/scheduler/
├── index.ts              # 调度器导出
├── cronManager.ts        # Cron 管理
├── taskQueue.ts          # 任务队列
└── types.ts              # 类型

src/core/tools/
├── memory.ts             # 记忆工具 (Phase 2)
└── scheduler.ts          # 定时任务工具 (Phase 5)

src/ui/commands/
├── deep.ts               # /deep 命令 (Phase 4)
├── schedule.ts           # /schedule 命令 (Phase 5)
└── agents.ts             # /agents 命令 (Phase 6)

src/ui/components/
├── AgentStatusBar.tsx    # Agent 状态栏
├── MemoryIndicator.tsx   # 记忆指示器
└── SchedulerPanel.tsx    # 调度面板
```
