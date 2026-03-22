# 架构分层重构 + Multi-Agent 默认启用

## 目标
1. 修复 Core→UI 的层违反（MessageItem 类型移到 core）
2. config.ts 的 console.log 改为返回结构化数据
3. Multi-Agent Supervisor 作为默认模式启用（不需要向前兼容）
4. Settings 新增 agentMode 配置

---

## Step 1: 将 MessageItem 类型移到 Core 层

**问题**: `src/core/session/storage.ts` 和 `deserializer.ts` 从 `src/ui/types/messages.ts` 导入 `MessageItem`，违反分层原则。

**改动**:
1. 创建 `src/core/types/messages.ts`，把 `MessageItem` 及其子类型、`generateMessageId()` 等搬过去
2. `src/ui/types/messages.ts` 改为从 `src/core/types/messages.ts` re-export（UI 层依赖 Core 层，方向正确）
3. `src/core/session/storage.ts` 和 `deserializer.ts` 改为从 `../../types/messages.js` 导入

---

## Step 2: config.ts 去除 console.log

**问题**: `listModels()` 直接 console.log，`initializeModels()` 和 `refreshAllModels()` 也有 console.log/error。

**改动**:
1. `listModels()` 改为 `getModelsListData()` 返回结构化数据（`ModelListData` 类型）
2. `initializeModels()` 和 `refreshAllModels()` 的 console.log 替换为 `log.info()`，console.error 替换为 `log.error()`
3. `cli.tsx` 中的 `listModels()` 调用改为获取数据后自行格式化输出

---

## Step 3: Settings 新增 agentMode

**改动**:
1. `src/core/settings.ts` 的 `Settings` 接口新增 `agentMode: "supervisor" | "single"`
2. 默认值设为 `"supervisor"`
3. `mergeWithEnv` 处理 `AGENT_MODE` 环境变量
4. 导出 `getAgentMode()` 函数

---

## Step 4: Multi-Agent Supervisor 作为默认模式

**改动**:
1. `src/core/agent/index.ts` 的 `multiTurnChat()` 函数中：
   - 当 `agentMode === "supervisor"` 时，调用 supervisor 的流程
   - 当 `agentMode === "single"` 时，使用现有 StateGraph 流程
2. `src/core/agent/supervisor.ts` 增强：
   - 支持多轮对话（使用 checkpointer + threadId）
   - 支持事件流（streaming、tool_use 等事件）
   - 对接现有的权限系统
3. 删除 `/supervisor` 命令（不再需要，因为已经是默认模式）
4. 从 `src/ui/commands/index.ts` 移除 supervisor 命令注册

---

## Step 5: 测试 & 构建验证

1. `bun run typecheck`
2. `bun test`
3. `bun run build`

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/core/types/messages.ts` | 新增 | MessageItem 类型定义 |
| `src/ui/types/messages.ts` | 修改 | 改为从 core re-export |
| `src/core/session/storage.ts` | 修改 | 导入路径改为 core |
| `src/core/session/deserializer.ts` | 修改 | 导入路径改为 core |
| `src/core/config.ts` | 修改 | listModels→getModelsListData，去掉 console |
| `src/cli.tsx` | 修改 | 格式化 model list 输出 |
| `src/core/settings.ts` | 修改 | 新增 agentMode |
| `src/core/agent/index.ts` | 修改 | multiTurnChat 根据 agentMode 分派 |
| `src/core/agent/supervisor.ts` | 修改 | 增强为支持多轮对话 + 事件流 |
| `src/ui/commands/supervisor.ts` | 删除 | 不再需要单独命令 |
| `src/ui/commands/index.ts` | 修改 | 移除 supervisor 注册 |
