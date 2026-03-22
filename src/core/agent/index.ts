import {
  StateGraph,
  MessagesAnnotation,
  Annotation,
  START,
  END,
  interrupt,
  Command,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { createCheckpointer, type Checkpointer } from "./checkpointer.js";
import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage, BaseMessage, ToolMessage, RemoveMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import {
  tools,
  allTools,
  getToolsForCurrentMode,
  getTodos,
  SENSITIVE_TOOLS,
  canRunToolsConcurrently,
  getToolMetadata,
  needsPermission,
  setPreviousModeBeforePlan,
} from "../tools/index.js";
import {
  getSkillRuntime,
  getToolsForActiveSkill,
  getActiveSkillSystemPrompt,
} from "../skills/index.js";
import {
  hasToolPermission,
  isSafeBashCommand,
  getCommandPrefix,
  saveToolPermission,
} from "../permissions.js";
import { isSafeModeEnabled, getPermissionMode, isToolAllowedInCurrentMode, PLAN_MODE_TOOLS, getAgentMode } from "../settings.js";
import { runSupervisorStream, abortSupervisorRequest, resetSupervisorGraph } from "./supervisor.js";
import { callChatModel, simpleChatWithModel } from "./models.js";
import { getDefaultModel, getModelConfig, supportsToolCalling } from "../config.js";
import { log } from "../../logger.js";
import {
  buildComprehensiveSummaryPrompt,
  countMessageTokens,
  getContextUsage,
} from "./memory.js";
import {
  generateContextInjection,
  wrapToolResult,
  generateTodoWriteHint,
} from "../context/index.js";
import {
  appendDailyLog,
} from "../services/memory.js";
import {
  getAntiHallucinationPipeline,
  resetPipeline,
} from "../middleware/index.js";
import {
  buildSystemPrompt,
  buildDynamicInjection,
} from "../prompt/index.js";
import {
  getSystemEventQueue,
  SystemEventQueue,
} from "../events/index.js";
import {
  emitThinking,
  emitStreaming,
  emitToolUse,
  emitToolProgress,
  emitToolResult,
  emitResponse,
  emitError,
  emitConfirmRequired,
  emitCompacting,
  emitAutoCompact,
  emitTokenUsage,
  emitDone,
  createToolAbortController,
  abortToolExecution,
  clearToolAbortController,
  setCurrentToolCallId,
  getCurrentToolCallId,
  clearToolCallIds,
} from "./events.js";

// ============ State 定义 ============

// UsageMetadata 类型定义（从 LangChain）
interface UsageMetadata {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_token_details?: {
    cache_read?: number;
    cache_creation?: number;
  };
  output_token_details?: {
    reasoning?: number;
  };
}

// 扩展 MessagesAnnotation 添加自定义字段
const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  skipNextCheck: Annotation<boolean>({
    reducer: (_, y) => y ?? false,
    default: () => false,
  }),
  // 保存上一次 LLM 响应的 usage_metadata（用于准确的 token 跟踪）
  lastUsageMetadata: Annotation<UsageMetadata | null>({
    reducer: (_, y) => y ?? null,
    default: () => null,
  }),
});

// ============ 辅助函数 ============

// 从 Anthropic 的 content 数组中提取文本内容
function extractTextContent(content: any): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return part.text;
        return "";
      })
      .join("");
  }
  return String(content);
}

// ============ 配置 ============

// 当前模型
let currentModel = getDefaultModel();

// System prompt 现在由 src/core/prompt/ 模块分层构建
// buildSystemPrompt() 从 ../prompt/index.js 导入


// 敏感工具列表从 tools/types.ts 导入
// 注意: 权限检查现在使用 permissions.ts 中的 hasToolPermission

// ============ 模型管理 ============

export function setAgentModel(model: string): void {
  const oldModel = currentModel;
  currentModel = model;
  log.info("Model changed", { from: oldModel, to: model });
  // Reset supervisor graph so it rebuilds with the new model
  resetSupervisorGraph();
}

export function getAgentModel(): string {
  return currentModel;
}

// ============ 工具确认设置 ============
// 现在使用 settings.ts 中的 safeMode 和 permissionMode
// 这些函数保留用于向后兼容

export function setToolConfirmation(enabled: boolean): void {
  // 向后兼容 - 实际使用 settings.ts 中的 safeMode
  log.info("Tool confirmation (legacy) - use safeMode in settings instead", { enabled });
}

export function getToolConfirmation(): boolean {
  return isSafeModeEnabled();
}

// ============ Checkpointer (持久化) ============

// 使用 SQLite 持久化 checkpointer（自动降级到 MemorySaver）
const checkpointer: Checkpointer = createCheckpointer();

// 当前线程 ID
let currentThreadId = `thread_${Date.now()}`;

export function setThreadId(threadId: string): void {
  currentThreadId = threadId;
}

export function getThreadId(): string {
  return currentThreadId;
}

export function newThread(): string {
  const oldThreadId = currentThreadId;
  currentThreadId = `thread_${Date.now()}`;
  log.info("New thread created", { oldThreadId, newThreadId: currentThreadId });
  return currentThreadId;
}

// ============ Graph 节点 ============

// Agent 节点 - 调用 LLM
const agentNode = async (
  state: typeof AgentState.State,
  _config?: RunnableConfig
) => {
  const startTime = Date.now();
  const modelConfig = getModelConfig(currentModel);
  const modelName = modelConfig?.model || currentModel;
  const permissionMode = getPermissionMode();

  log.nodeStart("agent", state);
  log.agentThinking(modelName);

  // Emit thinking event
  emitThinking(modelName);

  // 重置防幻觉管道（新一轮 agent 思考）
  resetPipeline();

  // 根据当前权限模式和活动技能获取可用工具
  // Priority: permission mode > active skill > all tools
  const modeTools = getToolsForCurrentMode();
  const skillRuntime = getSkillRuntime();
  const activeSkill = skillRuntime.getActiveSkill();

  // If a skill is active, filter tools further by skill's allowed tools
  let finalTools = modeTools;
  if (activeSkill && activeSkill.tools !== "*") {
    const skillAllowedTools = new Set(activeSkill.tools as string[]);
    finalTools = modeTools.filter(t => skillAllowedTools.has(t.name));
  }

  const availableTools = supportsToolCalling(currentModel) ? finalTools : [];

  log.debug("Tools available for current mode", {
    mode: permissionMode,
    activeSkill: activeSkill?.name || null,
    toolCount: availableTools.length,
    tools: availableTools.map(t => t.name),
  });

  // 准备消息列表：如果没有系统消息，添加系统提示
  let messagesWithSystem = [...state.messages];
  const hasSystemMessage = state.messages.some(m => m instanceof SystemMessage);
  if (!hasSystemMessage) {
    // 延迟构建系统提示，确保环境信息是最新的
    const systemPrompt = buildSystemPrompt();
    messagesWithSystem = [new SystemMessage(systemPrompt), ...messagesWithSystem];
  }

  // 注入上下文到最后一条用户消息
  // 三部分内容合并注入：
  // 1. CLAUDE.md、todo 列表、memory 等上下文
  // 2. 动态 prompt sections（技能覆盖、模式指令、防幻觉参考表）
  //    这些不能放 system prompt，否则会破坏 prompt cache 前缀匹配
  // 3. 系统事件队列（OpenClaw pattern: drain → inject）
  //    后台任务完成、文件变更等事件在此注入
  const contextInjection = generateContextInjection();
  const dynamicPromptInjection = buildDynamicInjection();

  // Drain 系统事件队列（OpenClaw pattern）
  const eventQueue = getSystemEventQueue();
  const pendingEvents = eventQueue.drain();
  const eventsInjection = SystemEventQueue.formatForInjection(pendingEvents);

  const fullInjection = [contextInjection, dynamicPromptInjection, eventsInjection].filter(Boolean).join("\n\n");

  if (fullInjection) {
    for (let i = messagesWithSystem.length - 1; i >= 0; i--) {
      const msg = messagesWithSystem[i];
      if (msg instanceof HumanMessage) {
        const originalContent = typeof msg.content === "string" ? msg.content : String(msg.content);
        messagesWithSystem[i] = new HumanMessage(originalContent + "\n" + fullInjection);
        log.debug("Context injected into user message", {
          contextLength: fullInjection.length,
          hasDynamicPrompt: !!dynamicPromptInjection,
          hasPendingEvents: pendingEvents.length > 0,
          pendingEventTypes: pendingEvents.map(e => e.type),
        });
        break;
      }
    }
  }

  // 使用统一的聊天模型接口
  const response = await callChatModel(messagesWithSystem, availableTools, currentModel, true);

  // 使用 LLM 返回的实际 token usage（最准确）
  // 参考: https://js.langchain.com/docs/how_to/chat_token_usage_tracking/
  // 参考: https://python.langchain.com/v0.2/docs/how_to/response_metadata/

  // 1. 优先使用 usage_metadata（标准字段）
  let usageMetadata = (response as any).usage_metadata as UsageMetadata | undefined;

  // 2. Fallback: 从 response_metadata.usage 构建（Anthropic 特有）
  if (!usageMetadata || !usageMetadata.total_tokens) {
    const responseMetadata = (response as any).response_metadata;
    if (responseMetadata?.usage) {
      const { input_tokens, output_tokens } = responseMetadata.usage;
      usageMetadata = {
        input_tokens: input_tokens || 0,
        output_tokens: output_tokens || 0,
        total_tokens: (input_tokens || 0) + (output_tokens || 0),
      };
      log.debug("Using response_metadata.usage (Anthropic fallback)", {
        input_tokens: usageMetadata.input_tokens,
        output_tokens: usageMetadata.output_tokens,
        total_tokens: usageMetadata.total_tokens,
      });
    }
  }

  if (usageMetadata && usageMetadata.total_tokens > 0) {
    const { input_tokens = 0, output_tokens = 0, total_tokens = 0 } = usageMetadata;
    const modelConfig = getModelConfig(currentModel);
    const contextLimit = modelConfig?.contextWindow || 128000;
    const percentUsed = Math.round((total_tokens / contextLimit) * 100);

    log.debug("LLM usage_metadata (actual)", {
      input_tokens,
      output_tokens,
      total_tokens,
      contextLimit,
      percentUsed: `${percentUsed}%`,
      ...(usageMetadata.input_token_details && {
        cache_read: usageMetadata.input_token_details.cache_read,
        cache_creation: usageMetadata.input_token_details.cache_creation,
      }),
      ...(usageMetadata.output_token_details && {
        reasoning: usageMetadata.output_token_details.reasoning,
      }),
    });

    emitTokenUsage(total_tokens, contextLimit, percentUsed);

    log.nodeEnd("agent", { messages: [response] }, Date.now() - startTime);

    // 返回消息 + 保存 usage_metadata 到 state
    return {
      messages: [response],
      lastUsageMetadata: usageMetadata,
    };
  } else {
    // Fallback: 估算 token 使用情况（某些模型可能不返回 usage_metadata）
    log.debug("No usage_metadata from LLM, falling back to estimation");
    const updatedMessages = [...state.messages, response];
    const contextUsage = getContextUsage(updatedMessages, modelName);
    emitTokenUsage(contextUsage.tokenCount, contextUsage.contextLimit, contextUsage.percentUsed);

    log.nodeEnd("agent", { messages: [response] }, Date.now() - startTime);

    return { messages: [response] };
  }
};

// 追踪是否已经发射过确认事件（避免 resume 后重复发射）
let confirmationEmitted = false;

// 工具确认节点 - 在执行敏感工具前请求确认
const toolConfirmationNode = async (state: typeof AgentState.State) => {
  log.nodeStart("confirm_tools", state);
  const startTime = Date.now();

  const lastMessage = state.messages[state.messages.length - 1];
  const toolCalls = AIMessage.isInstance(lastMessage) ? lastMessage.tool_calls : undefined;

  if (!toolCalls?.length) {
    log.debug("No tool calls to confirm");
    confirmationEmitted = false;
    return { messages: [] };
  }

  // 获取当前权限模式
  const permissionMode = getPermissionMode();

  // 使用新的权限系统检查每个工具调用
  const toolsNeedingPermission = toolCalls.filter(tc => {
    const args = tc.args as Record<string, unknown>;

    // acceptEdits 模式下，只有 Bash 命令需要确认
    if (permissionMode === "acceptEdits" && tc.name !== "Bash") {
      return false;
    }

    const result = hasToolPermission(tc.name, args);
    return !result.allowed;
  });

  if (toolsNeedingPermission.length === 0) {
    log.debug("All tools have permission");
    confirmationEmitted = false;
    return { messages: [] };
  }

  log.info("Requesting tool confirmation", {
    toolsNeedingPermission: toolsNeedingPermission.map(tc => tc.name),
    totalToolCalls: toolCalls.length,
  });

  // 发射确认事件 - 只在第一次进入时发射，避免 resume 后重复发射
  if (!confirmationEmitted) {
    confirmationEmitted = true;
    emitConfirmRequired(toolsNeedingPermission.map(tc => {
      const args = tc.args as Record<string, unknown>;
      return {
        name: tc.name,
        args: args,
        toolCallId: tc.id || `tool_${Date.now()}`,
        // 额外信息用于 UI 显示
        commandPrefix: tc.name === "Bash" ? getCommandPrefix(args.command as string || "") : null,
      };
    }));
  }

  // 使用 interrupt 等待用户确认
  log.info("Interrupting for user confirmation");
  const response = interrupt({
    type: "tool_confirmation",
    tools: toolsNeedingPermission.map(tc => ({
      name: tc.name,
      args: tc.args,
    })),
    message: "是否执行这些工具？",
  });

  // 重置确认标志 - 已经收到响应了
  confirmationEmitted = false;

  // 解析响应
  // 响应格式: { approved: boolean, savePermission?: 'prefix' | 'full' | false }
  if (typeof response === "object" && response !== null) {
    const { approved, savePermission, toolIndex = 0 } = response as any;

    if (approved) {
      // 如果需要保存权限
      if (savePermission) {
        const tc = toolsNeedingPermission[toolIndex] || toolsNeedingPermission[0];
        if (tc) {
          const args = tc.args as Record<string, unknown>;
          saveToolPermission(tc.name, args, savePermission === "prefix");
        }
      }

      log.info("Tool execution approved", {
        tools: toolsNeedingPermission.map(tc => tc.name),
        savePermission,
      });
      log.nodeEnd("confirm_tools", { approved: true }, Date.now() - startTime);
      return { messages: [] };
    }
  }

  // 工具被拒绝
  log.info("Tool execution rejected", {
    tools: toolsNeedingPermission.map(tc => tc.name),
    response,
  });
  log.nodeEnd("confirm_tools", { approved: false }, Date.now() - startTime);

  // pattern: 返回 ToolMessage 告诉 LLM 工具被拒绝，让 agent 继续处理
  const REJECT_MESSAGE = "The user rejected this tool use. The tool was NOT executed. STOP what you are doing and wait for the user to tell you how to proceed. Ask the user what they would like to do instead.";

  // 为每个被拒绝的工具创建 ToolMessage
  const rejectMessages: ToolMessage[] = [];
  for (const tc of toolsNeedingPermission) {
    const storedId = getCurrentToolCallId(tc.name);
    const toolCallId = storedId || tc.id || `tool_${Date.now()}`;

    // 发射 tool_result 事件，更新 UI
    emitToolResult(tc.name, "(rejected by user)", toolCallId, true);

    // 创建 ToolMessage 告诉 LLM 工具被拒绝
    rejectMessages.push(
      new ToolMessage({
        content: REJECT_MESSAGE,
        tool_call_id: toolCallId,
        name: tc.name,
      })
    );
  }

  // 清理 tool call IDs
  clearToolCallIds();

  // 返回拒绝消息，agent 会继续处理这些 ToolMessage 并生成新响应
  return {
    messages: rejectMessages,
  };
};

// 创建工具节点 - 使用所有工具，因为权限检查在 agent 节点处理
// 注意：Plan mode 的工具过滤在 agentNode 中完成，toolNode 只执行被调用的工具
const toolNode = new ToolNode(allTools);

const summarizeNode = async (
  state: typeof AgentState.State,
  _config?: RunnableConfig
) => {
  const startTime = Date.now();
  const modelConfig = getModelConfig(currentModel);
  const modelName = modelConfig?.model || currentModel;

  log.nodeStart("summarize", state);
  log.info("Context limit approaching, generating summary...");

  const tokenCount = countMessageTokens(state.messages);
  emitCompacting(tokenCount);

  const nonSystemMessages = state.messages.filter(m => !(m instanceof SystemMessage));

  if (nonSystemMessages.length < 3) {
    log.debug("Not enough messages to summarize (less than 3)");
    log.nodeEnd("summarize", { skipped: true }, Date.now() - startTime);
    return { messages: [], skipNextCheck: true };
  }

  // Memory flush: save key context to daily log before compaction
  try {
    const recentMessages = nonSystemMessages.slice(-10);
    const contextSnippets = recentMessages
      .filter(m => typeof m.content === "string" && m.content.length > 0)
      .map(m => (typeof m.content === "string" ? m.content : "").slice(0, 200))
      .join("\n");
    if (contextSnippets.length > 0) {
      appendDailyLog(
        `**Auto-saved before compaction**\n\n${contextSnippets.slice(0, 2000)}`,
        "project"
      );
      log.debug("Memory flush: saved context before compaction");
    }
  } catch (flushError: any) {
    log.warn("Memory flush failed", { error: flushError.message });
  }

  // 策略：在 LangGraph 流程中生成总结
  // 添加总结请求，使用 callChatModel（和 agent 节点相同的函数）
  log.info("Generating comprehensive summary with LLM", {
    messagesToSummarize: nonSystemMessages.length,
    model: modelName,
  });

  const summaryPrompt = buildComprehensiveSummaryPrompt(nonSystemMessages);
  const summaryRequest = new HumanMessage(summaryPrompt);

  // 构建消息列表：所有历史 + 总结请求
  const messagesForSummary = [...state.messages, summaryRequest];

  try {
    // 使用 callChatModel（和 agent 节点相同），但不提供工具
    emitThinking(modelName);
    const response = await callChatModel(messagesForSummary, [], currentModel, true);

    const summaryContent = typeof response.content === "string"
      ? response.content
      : extractTextContent(response.content);

    // 1. 压缩通知（用户消息）
    const compactNotice = new HumanMessage({
      content: "Context automatically compressed due to token limit. Essential information preserved.",
      id: `compact_notice_${Date.now()}`,
    });

    // 2. 总结内容（AI 响应）
    const summaryResponse = new AIMessage({
      content: summaryContent,
      id: `summary_${Date.now()}`,
    });

    // 3. 删除所有历史消息
    const removeMessages = nonSystemMessages
      .filter(m => m.id)
      .map(m => new RemoveMessage({ id: m.id! }));

    log.info("Summary generated, all conversation history replaced", {
      summaryLength: summaryContent.length,
      removedMessages: removeMessages.length,
      durationMs: Date.now() - startTime,
    });

    emitAutoCompact(
      state.messages.length,
      2, // compactNotice + summaryResponse
      summaryContent
    );

    log.nodeEnd("summarize", {
      summaryGenerated: true,
      removedCount: removeMessages.length
    }, Date.now() - startTime);

    // 返回：删除所有旧消息 + 添加压缩通知和总结
    return {
      messages: [...removeMessages, compactNotice, summaryResponse]
    };
  } catch (error: any) {
    log.error("Failed to generate summary", { error: error.message });
    log.nodeEnd("summarize", { error: error.message }, Date.now() - startTime);
    return { messages: [], skipNextCheck: true };
  }
};

// ============ 条件边 ============

// 判断是否需要调用工具
const shouldContinue = (
  state: typeof AgentState.State
): "tools" | "confirm_tools" | typeof END => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  // 使用 AIMessage.isInstance 来检查，它同时支持 AIMessage 和 AIMessageChunk
  // 参考: https://js.langchain.com/docs/how_to/tool_calling/
  const toolCalls = AIMessage.isInstance(lastMessage) ? lastMessage.tool_calls : undefined;
  const invalidToolCalls = AIMessage.isInstance(lastMessage) ? (lastMessage as any).invalid_tool_calls : undefined;

  const permissionMode = getPermissionMode();

  log.debug("shouldContinue check", {
    lastMessageType: lastMessage?.constructor?.name,
    isAIMessage: AIMessage.isInstance(lastMessage),
    hasToolCalls: !!(toolCalls && toolCalls.length > 0),
    toolCallsCount: toolCalls?.length || 0,
    invalidToolCallsCount: invalidToolCalls?.length || 0,
    safeMode: isSafeModeEnabled(),
    permissionMode,
  });

  // 检查是否有无效的工具调用（格式错误的参数）
  // 如果有无效调用，停止执行并报告错误
  if (invalidToolCalls && invalidToolCalls.length > 0) {
    log.error("Invalid tool calls detected, stopping execution", {
      count: invalidToolCalls.length,
      invalidCalls: invalidToolCalls.map((tc: any) => ({
        name: tc.name,
        error: tc.error,
      })),
    });
    // 发送错误事件给 UI
    emitError(`LLM returned malformed tool calls: ${invalidToolCalls.map((tc: any) => `${tc.name}: ${tc.error}`).join(", ")}`);
    log.conditionalEdge("agent", "shouldContinue", "END (invalid tool calls)");
    return END;
  }

  if (toolCalls && toolCalls.length > 0) {
    // 检查是否需要工具确认
    // 权限模式：
    // - bypassPermissions: 跳过所有确认
    // - acceptEdits: 只确认 Bash 命令
    // - default: 正常权限检查
    if (permissionMode === "bypassPermissions") {
      log.conditionalEdge("agent", "shouldContinue", "tools (bypass)");
      log.info("Bypassing permission confirmation (bypassPermissions mode)");
      return "tools";
    }

    if (isSafeModeEnabled()) {
      // 检查是否有任何工具需要权限
      const toolsNeedingPermission = toolCalls.filter(tc => {
        const args = tc.args as Record<string, unknown>;

        // acceptEdits 模式下，只有 Bash 命令需要确认
        if (permissionMode === "acceptEdits" && tc.name !== "Bash") {
          return false;
        }

        const result = hasToolPermission(tc.name, args);
        return !result.allowed;
      });

      if (toolsNeedingPermission.length > 0) {
        log.conditionalEdge("agent", "shouldContinue", "confirm_tools");
        log.info("Tools need permission confirmation", {
          tools: toolsNeedingPermission.map(tc => tc.name),
          permissionMode,
        });
        return "confirm_tools";
      }
    }

    log.conditionalEdge("agent", "shouldContinue", "tools");
    return "tools";
  }

  log.conditionalEdge("agent", "shouldContinue", "END");
  return END;
};

// 确认后的路由
const afterConfirmation = (
  state: typeof AgentState.State
): "tools" | "agent" => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  // pattern: 如果确认节点返回了 ToolMessage（拒绝消息），
  // 路由到 agent 让 LLM 处理拒绝并生成新响应
  if (lastMessage instanceof ToolMessage) {
    log.conditionalEdge("confirm_tools", "afterConfirmation", "agent (rejected)");
    return "agent";
  }

  // 批准后执行工具
  log.conditionalEdge("confirm_tools", "afterConfirmation", "tools");
  return "tools";
};

// 检查消息点 - 在进入 agent 之前检查是否需要总结或 auto-compact
const checkMessages = (
  state: typeof AgentState.State
): "summarize" | "agent" => {
  const { messages, skipNextCheck, lastUsageMetadata } = state;

  // 如果上次 summarize 发现没有可压缩内容，跳过本次检查
  if (skipNextCheck) {
    log.conditionalEdge("check", "checkMessages", "agent (skip check)");
    return "agent";
  }

  const modelConfig = getModelConfig(currentModel);
  const modelName = modelConfig?.model || currentModel;
  const contextLimit = modelConfig?.contextWindow || 128000;

  let totalTokens = 0;
  let estimationMethod = "";

  // 策略：优先使用 LLM 返回的 usage_metadata + 估算新增的 ToolMessage
  if (lastUsageMetadata) {
    // 1. 从上一次 Agent 响应获取基准 token 数
    const baseTokens = lastUsageMetadata.total_tokens;

    // 2. 找到上一次 Agent 响应后新增的消息（主要是 ToolMessage）
    // 找到最后一条 AIMessage 的索引
    let lastAIMessageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (AIMessage.isInstance(messages[i])) {
        lastAIMessageIndex = i;
        break;
      }
    }

    const newMessages = lastAIMessageIndex >= 0
      ? messages.slice(lastAIMessageIndex + 1)
      : [];

    // 3. 估算新增消息的 token
    const newMessagesTokens = countMessageTokens(newMessages);

    // 4. 总 token = 基准 + 新增
    totalTokens = baseTokens + newMessagesTokens;
    estimationMethod = "hybrid (usage_metadata + estimation)";

    log.debug("Token calculation (hybrid)", {
      baseTokens,
      newMessagesCount: newMessages.length,
      newMessagesTokens,
      totalTokens,
      contextLimit,
    });
  } else {
    // Fallback: 完全估算（某些模型不返回 usage_metadata）
    const contextUsage = getContextUsage(messages, modelName);
    totalTokens = contextUsage.tokenCount;
    estimationMethod = "full estimation";

    log.debug("Token calculation (fallback)", {
      totalTokens,
      contextLimit,
    });
  }

  const percentUsed = Math.round((totalTokens / contextLimit) * 100);
  const isAboveAutoCompactThreshold = percentUsed >= 92;

  if (isAboveAutoCompactThreshold) {
    log.conditionalEdge("check", "checkMessages", "summarize (auto-compact)");
    log.info("Auto-compact triggered: context usage above 92%", {
      messageCount: messages.length,
      totalTokens,
      percentUsed,
      contextLimit,
      estimationMethod,
    });
    return "summarize";
  }

  log.conditionalEdge("check", "checkMessages", "agent");
  return "agent";
};

// ============ 构建 Graph ============

// Check 节点 - 重置标志并发射 token usage
const checkNode = (state: typeof AgentState.State) => {
  const { lastUsageMetadata, messages } = state;
  const modelConfig = getModelConfig(currentModel);
  const contextLimit = modelConfig?.contextWindow || 128000;

  // 如果有 usage_metadata，发射更新的 token usage 到 UI
  if (lastUsageMetadata) {
    // 计算包含新增 ToolMessage 的总 token 数
    let lastAIMessageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (AIMessage.isInstance(messages[i])) {
        lastAIMessageIndex = i;
        break;
      }
    }

    const newMessages = lastAIMessageIndex >= 0 ? messages.slice(lastAIMessageIndex + 1) : [];
    const newMessagesTokens = countMessageTokens(newMessages);
    const totalTokens = lastUsageMetadata.total_tokens + newMessagesTokens;
    const percentUsed = Math.round((totalTokens / contextLimit) * 100);

    // 发射更新的 token usage（包含工具执行后的消息）
    emitTokenUsage(totalTokens, contextLimit, percentUsed);

    log.debug("Check node: token usage updated", {
      baseTokens: lastUsageMetadata.total_tokens,
      newMessagesTokens,
      totalTokens,
      percentUsed: `${percentUsed}%`,
    });
  }

  return { skipNextCheck: false };
};

const graphBuilder = new StateGraph(AgentState)
  .addNode("check", checkNode)
  .addNode("agent", agentNode)
  .addNode("confirm_tools", toolConfirmationNode)
  .addNode("tools", toolNode)
  .addNode("summarize", summarizeNode)
  // 关键修复:从 START 先进入 check 节点,检查是否需要压缩
  .addEdge(START, "check")
  // check 节点根据上下文使用情况决定是否需要先压缩
  .addConditionalEdges("check", checkMessages, {
    summarize: "summarize",
    agent: "agent",
  })
  .addConditionalEdges("agent", shouldContinue, {
    tools: "tools",
    confirm_tools: "confirm_tools",
    [END]: END,
  })
  .addConditionalEdges("confirm_tools", afterConfirmation, {
    tools: "tools",
    agent: "agent",  // pattern: 拒绝后路由到 agent 继续处理
  })
  // 工具执行后回到 check 节点,再次检查是否需要总结
  .addEdge("tools", "check")
  // 总结后继续执行 agent
  .addEdge("summarize", "agent");

// 编译 Graph（带 checkpointer 支持持久化）
const graph = graphBuilder.compile({
  checkpointer,
});

// ============ UI 处理 ============

// 处理流式更新的 UI 回显
function handleStreamUpdate(nodeName: string, update: any): void {
  log.debug("Stream update received", {
    node: nodeName,
    messageCount: update.messages?.length || 0,
  });

  if (nodeName === "agent" && update.messages) {
    const lastMsg = update.messages[update.messages.length - 1];
    const msgToolCalls = AIMessage.isInstance(lastMsg) ? lastMsg.tool_calls : undefined;

    // First, emit any text content from the AI message
    // This handles cases where AI sends text before/after tool calls
    if (AIMessage.isInstance(lastMsg)) {
      let content = typeof lastMsg.content === "string" ? lastMsg.content : extractTextContent(lastMsg.content);
      if (content && content.trim()) {
        // Post-processing: 还原占位符为真实值
        const ahPipeline = getAntiHallucinationPipeline();
        if (ahPipeline.hasActiveMappings()) {
          const ppResult = ahPipeline.processModelOutput(content);
          content = ppResult.content;
          if (ppResult.restore.restoredCount > 0) {
            log.info("Anti-hallucination post-processing applied", {
              restored: ppResult.restore.restoredCount,
              corrections: ppResult.restore.corrections.length,
              warnings: ppResult.validation.warnings.length,
            });
          }
        }

        log.debug("Agent response content", {
          contentLength: content.length,
          hasToolCalls: !!(msgToolCalls && msgToolCalls.length > 0),
        });
        emitResponse(content);
      }
    }

    // Then, emit tool use events if there are tool calls
    if (msgToolCalls && msgToolCalls.length > 0) {
      log.info("Agent requesting tool calls", {
        toolCount: msgToolCalls.length,
        tools: msgToolCalls.map((tc: any) => tc.name),
      });
      log.info("Tool calls summary", {
        tools: msgToolCalls.map((tc: any) => tc.name),
      });

      // 创建工具 AbortController（用于工具取消）
      createToolAbortController();

      // Emit tool use events for each tool call and set tool call IDs
      for (const tc of msgToolCalls) {
        const toolCallId = tc.id || `tool_${Date.now()}`;
        setCurrentToolCallId(tc.name, toolCallId);
        emitToolUse(tc.name, tc.args as Record<string, unknown>, toolCallId);
      }
    }
  } else if (nodeName === "tools" && update.messages) {
    // 工具执行完成，清理 AbortController 和 tool call IDs
    clearToolAbortController();
    clearToolCallIds();

    // 获取防幻觉管道
    const ahPipeline = getAntiHallucinationPipeline();

    for (const msg of update.messages) {
      if (msg instanceof ToolMessage) {
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

        // Pre-processing: 将 tool_result 中的高熵 ID 替换为占位符
        const processedContent = ahPipeline.processToolResult(content, msg.name || "unknown");

        // 如果内容被重映射，更新 ToolMessage 的 content
        if (processedContent !== content) {
          (msg as any).content = processedContent;
          log.debug("Tool result remapped by anti-hallucination pipeline", {
            tool: msg.name,
            originalLength: content.length,
            processedLength: processedContent.length,
          });
        }

        const preview = processedContent.length > 200 ? processedContent.slice(0, 200) + "..." : processedContent;
        log.info("Tool execution result", {
          tool: msg.name || "unknown",
          resultLength: processedContent.length,
          preview: preview.slice(0, 100),
        });
        log.debug("Tool result", { tool: msg.name, preview });
        // Emit tool result event (原始内容用于 UI 展示)
        emitToolResult(msg.name || "tool", content, msg.tool_call_id || `result_${Date.now()}`);
      }
    }
  }
}

// ============ 核心执行方法 ============

// 当前的 AbortController（用于中断请求）
let currentAbortController: AbortController | null = null;

/**
 * 中断当前正在执行的请求
 * 同时取消图执行和正在运行的工具
 */
export function abortCurrentRequest(): boolean {
  let aborted = false;

  // 取消图执行（single mode）
  if (currentAbortController && !currentAbortController.signal.aborted) {
    currentAbortController.abort();
    aborted = true;
  }

  // 取消 supervisor 模式的请求
  if (abortSupervisorRequest()) {
    aborted = true;
  }

  // 取消正在执行的工具
  if (abortToolExecution()) {
    aborted = true;
  }

  if (aborted) {
    log.info("Request and tool execution aborted by user");
  }
  return aborted;
}

/**
 * 检查当前请求是否已被中断
 */
export function isAborted(): boolean {
  return currentAbortController?.signal.aborted ?? false;
}

// 获取运行配置
function getRunConfig(): RunnableConfig {
  return {
    configurable: {
      thread_id: currentThreadId,
    },
    // LangGraph 默认递归限制是 25，不支持完全禁用
    // 设置为 Number.MAX_SAFE_INTEGER 实现"无限"执行
    // 实际控制由 token 管理来处理
    recursionLimit: Number.MAX_SAFE_INTEGER,
  };
}

// Return type for runGraphWithStream
interface StreamResult {
  messages: BaseMessage[];
  interrupted: boolean;
}

// 使用流式执行的核心方法
async function runGraphWithStream(
  input: { messages: BaseMessage[] } | null,
  config?: RunnableConfig
): Promise<StreamResult> {
  const startTime = Date.now();

  // 创建新的 AbortController
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const runConfig = { ...getRunConfig(), ...config };

  log.graphStart(input?.messages?.length || 0);
  log.info("Graph stream started", {
    threadId: currentThreadId,
    inputType: input ? "messages" : "command",
  });

  const stream = await graph.stream(
    input,
    {
      ...runConfig,
      streamMode: "updates",
      signal, // 传递 abort signal
    }
  );

  let allMessages: BaseMessage[] = input?.messages ? [...input.messages] : [];
  let nodeCount = 0;
  let wasInterrupted = false;

  try {
    for await (const chunk of stream) {
      // 检查是否已中断
      if (signal.aborted) {
        log.info("Stream aborted by user");
        wasInterrupted = true;
        break;
      }

      for (const [nodeName, update] of Object.entries(chunk)) {
        nodeCount++;
        log.debug("Processing stream chunk", { nodeCount, nodeName });
        handleStreamUpdate(nodeName, update);

        if ((update as any).messages) {
          allMessages = [...allMessages, ...(update as any).messages];
        }
      }
    }
  } catch (error: any) {
    if (error.name === 'AbortError' || signal.aborted) {
      log.info("Request aborted");
      return { messages: allMessages, interrupted: true };
    }
    throw error;
  } finally {
    currentAbortController = null;
  }

  const durationMs = Date.now() - startTime;
  log.graphEnd(allMessages.length, durationMs);
  log.info("Graph stream completed", {
    threadId: currentThreadId,
    totalMessages: allMessages.length,
    nodesExecuted: nodeCount,
    durationMs,
    wasInterrupted,
  });
  return { messages: allMessages, interrupted: wasInterrupted };
}

// ============ 公共 API ============

// 单次聊天（不保存历史）
export async function chat(message: string): Promise<string> {
  log.info("Single chat started", { messageLength: message.length });
  log.userInput(message);

  try {
    const result = await runGraphWithStream({
      messages: [new HumanMessage(message)],
    });

    const lastMessage = result.messages[result.messages.length - 1];
    // Handle case where lastMessage is undefined (e.g., after abort)
    if (!lastMessage) {
      log.info("Single chat aborted or no response");
      return "";
    }
    const response = AIMessage.isInstance(lastMessage)
      ? (typeof lastMessage.content === "string" ? lastMessage.content : extractTextContent(lastMessage.content))
      : String(lastMessage.content);

    log.info("Single chat completed", {
      responseLength: response.length,
      totalMessages: result.messages.length,
    });
    return response;
  } catch (error: any) {
    log.error("Single chat failed", { error: error.message, stack: error.stack });
    throw error;
  }
}

// 多轮对话（使用 checkpointer 持久化）
export async function multiTurnChat(message: string): Promise<string> {
  const agentMode = getAgentMode();
  log.info("Multi-turn chat started", {
    messageLength: message.length,
    threadId: currentThreadId,
    agentMode,
  });
  log.userInput(message);

  isAgentBusy = true;
  try {
    let result: { messages: BaseMessage[]; interrupted: boolean };

    if (agentMode === "supervisor") {
      // Multi-agent supervisor mode
      result = await runSupervisorStream(
        { messages: [new HumanMessage(message)] },
        currentThreadId,
        currentModel,
      );
    } else {
      // Single agent mode (legacy)
      result = await runGraphWithStream({
        messages: [new HumanMessage(message)],
      });
    }

    const lastMessage = result.messages[result.messages.length - 1];
    // Handle case where lastMessage is undefined (e.g., after abort)
    if (!lastMessage) {
      log.info("Multi-turn chat aborted or no response", { threadId: currentThreadId });
      emitDone(result.interrupted);
      return "";
    }
    const response = AIMessage.isInstance(lastMessage)
      ? (typeof lastMessage.content === "string" ? lastMessage.content : extractTextContent(lastMessage.content))
      : String(lastMessage.content);

    log.info("Multi-turn chat completed", {
      responseLength: response.length,
      totalMessages: result.messages.length,
      threadId: currentThreadId,
      agentMode,
    });

    // Emit done event with interrupted flag
    emitDone(result.interrupted);

    return response;
  } catch (error: any) {
    log.error("Multi-turn chat failed", { error: error.message, threadId: currentThreadId });
    // Emit error event
    emitError(error.message);
    emitDone();
    throw error;
  } finally {
    isAgentBusy = false;

    // 处理 agent 忙碌期间积累的后台通知
    if (pendingNotifications.length > 0) {
      const nextNotification = pendingNotifications.shift()!;
      log.info("Processing queued background notification after agent turn", {
        remaining: pendingNotifications.length,
      });
      queueMicrotask(() => {
        notifyAgent(nextNotification).catch(error => {
          log.error("Failed to process queued notification", { error: error.message });
        });
      });
    }
  }
}

// ============ 后台任务通知 (Claude Code pattern) ============

/**
 * 是否有正在执行的 agent 请求（防止重入）
 */
let isAgentBusy = false;

/**
 * 待处理的通知队列（agent 忙碌时暂存）
 */
let pendingNotifications: string[] = [];

/**
 * 设置后台任务通知回调
 *
 * Claude Code pattern：后台任务完成时，不轮询，直接回调触发 agent 响应。
 *
 * 工作原理：
 * 1. SystemEventQueue.onNotify 注册回调
 * 2. 后台任务完成 → enqueue(strategy:"notify") → 回调触发
 * 3. 回调中注入 HumanMessage 触发新的 agent turn
 * 4. Agent 在新 turn 中 drain queue → 处理完成事件 → 继续响应
 *
 * 防重入：如果 agent 正在处理请求，通知暂存，等 agent 空闲时自动处理。
 */
export function setupBackgroundNotification(): void {
  const queue = getSystemEventQueue();
  queue.onNotify((event) => {
    log.info("Background notification received", {
      type: event.type,
      id: event.id,
    });

    const message = `[Background task notification] A background task has completed. Check the system events for details and continue accordingly.`;

    if (isAgentBusy) {
      // Agent 正在忙碌，暂存通知
      // 事件已在 queue 中，下轮 drain 时会自动注入
      pendingNotifications.push(message);
      log.info("Agent is busy, notification queued for next turn", {
        pendingCount: pendingNotifications.length,
      });
      return;
    }

    // Agent 空闲，直接触发新 turn
    notifyAgent(message).catch(error => {
      log.error("Failed to notify agent of background task", { error: error.message });
    });
  });

  log.info("Background notification callback registered");
}

/**
 * 触发 agent 处理通知
 *
 * 注入一条 HumanMessage 让 agent 处理后台任务结果。
 * Agent 在 agentNode 中会 drain queue 获取具体事件内容。
 */
async function notifyAgent(message: string): Promise<void> {
  if (isAgentBusy) return;

  isAgentBusy = true;
  try {
    emitThinking(currentModel);
    await runGraphWithStream({
      messages: [new HumanMessage(message)],
    });
    emitDone();
  } catch (error: any) {
    log.error("Background notification agent run failed", { error: error.message });
    emitError(error.message);
    emitDone();
  } finally {
    isAgentBusy = false;

    // 处理暂存的通知
    if (pendingNotifications.length > 0) {
      const nextNotification = pendingNotifications.shift()!;
      log.info("Processing queued notification", {
        remaining: pendingNotifications.length,
      });
      // 使用 queueMicrotask 避免递归调用栈
      queueMicrotask(() => {
        notifyAgent(nextNotification).catch(error => {
          log.error("Failed to process queued notification", { error: error.message });
        });
      });
    }
  }
}

// 恢复执行（用于 interrupt 后继续）
export async function resume(value: any): Promise<string> {
  log.info("Resuming execution after interrupt", {
    value,
    threadId: currentThreadId,
  });

  try {
    const result = await runGraphWithStream(
      new Command({ resume: value }) as any
    );

    const lastMessage = result.messages[result.messages.length - 1];
    // Handle case where lastMessage is undefined (e.g., after abort)
    if (!lastMessage) {
      log.info("Resume aborted or no response", { threadId: currentThreadId });
      emitDone(result.interrupted);
      return "";
    }
    const response = AIMessage.isInstance(lastMessage)
      ? (typeof lastMessage.content === "string" ? lastMessage.content : extractTextContent(lastMessage.content))
      : String(lastMessage.content);

    log.info("Resume completed", {
      responseLength: response.length,
      threadId: currentThreadId,
    });

    // Emit done event with interrupted flag
    emitDone(result.interrupted);

    return response;
  } catch (error: any) {
    log.error("Resume failed", { error: error.message, threadId: currentThreadId });
    emitError(error.message);
    emitDone();
    throw error;
  }
}

// 获取当前状态
export async function getState() {
  const state = await graph.getState(getRunConfig());
  log.debug("getState result", {
    hasState: !!state,
    hasValues: !!state?.values,
    keys: state ? Object.keys(state) : [],
    valuesKeys: state?.values ? Object.keys(state.values) : [],
  });
  return state;
}

// 获取状态历史
export async function* getStateHistory() {
  for await (const state of graph.getStateHistory(getRunConfig())) {
    yield state;
  }
}

// 清除历史（创建新线程）
export function clearHistory(): void {
  newThread();
  log.info("Conversation history cleared, new thread created");
}

// 恢复对话历史（用于 session resume）
export async function restoreHistory(messages: BaseMessage[]): Promise<void> {
  if (messages.length === 0) {
    log.debug("No messages to restore");
    return;
  }

  try {
    // 使用 updateState 将消息注入到当前 thread
    await graph.updateState(
      getRunConfig(),
      { messages },
      "agent"
    );

    log.info("History restored", {
      threadId: currentThreadId,
      messageCount: messages.length,
    });
  } catch (error: any) {
    log.error("Failed to restore history", { error: error.message });
    throw error;
  }
}

// 获取对话历史
export async function getHistory(): Promise<BaseMessage[]> {
  try {
    const state = await getState();
    const messages = state.values?.messages || [];
    log.debug("getHistory called", {
      hasState: !!state,
      hasValues: !!state.values,
      messageCount: messages.length,
    });
    return messages;
  } catch (error: any) {
    log.error("getHistory failed", { error: error.message });
    return [];
  }
}

export async function compactHistory(): Promise<{ before: number; after: number }> {
  const state = await getState();
  const messages: BaseMessage[] = state.values?.messages || [];

  if (messages.length === 0) {
    return { before: 0, after: 0 };
  }

  const nonSystemMessages = messages.filter(m => !(m instanceof SystemMessage));

  if (nonSystemMessages.length === 0) {
    return { before: messages.length, after: messages.length };
  }

  const summaryPrompt = buildComprehensiveSummaryPrompt(nonSystemMessages);
  const summaryContent = await simpleChatWithModel(
    [new HumanMessage(summaryPrompt)],
    currentModel
  );

  const summaryMessage = new HumanMessage({
    content: `[Previous Conversation Summary]\n${summaryContent}\n[End of Summary - The conversation continues below]`,
    id: `summary_${Date.now()}`,
  });

  const removeMessages = nonSystemMessages
    .filter(m => m.id)
    .map(m => new RemoveMessage({ id: m.id! }));

  await graph.updateState(
    getRunConfig(),
    { messages: [summaryMessage, ...removeMessages] },
    "agent"
  );

  log.info("History compacted manually", {
    before: messages.length,
    after: 1,
    removed: removeMessages.length,
  });

  return {
    before: messages.length,
    after: 1,
  };
}

// ============ Compact 相关 ============

const COMPRESSION_PROMPT = `Please provide a comprehensive summary of our conversation structured as follows:

## Technical Context
Development environment, tools, frameworks, and configurations in use. Programming languages, libraries, and technical constraints. File structure, directory organization, and project architecture.

## Project Overview
Main project goals, features, and scope. Key components, modules, and their relationships. Data models, APIs, and integration patterns.

## Code Changes
Files created, modified, or analyzed during our conversation. Specific code implementations, functions, and algorithms added. Configuration changes and structural modifications.

## Debugging & Issues
Problems encountered and their root causes. Solutions implemented and their effectiveness. Error messages, logs, and diagnostic information.

## Current Status
What we just completed successfully. Current state of the codebase and any ongoing work. Test results, validation steps, and verification performed.

## Pending Tasks
Immediate next steps and priorities. Planned features, improvements, and refactoring. Known issues, technical debt, and areas needing attention.

## User Preferences
Coding style, formatting, and organizational preferences. Communication patterns and feedback style. Tool choices and workflow preferences.

## Key Decisions
Important technical decisions made and their rationale. Alternative approaches considered and why they were rejected. Trade-offs accepted and their implications.

Focus on information essential for continuing the conversation effectively, including specific details about code, files, errors, and plans.`;

/**
 * 生成对话摘要
 * 用于 /compact 命令，使用 LLM 将当前对话压缩为结构化摘要
 */
export async function generateSummary(): Promise<string> {
  const state = await getState();
  const messages: BaseMessage[] = state.values?.messages || [];

  if (messages.length === 0) {
    return "";
  }

  log.info("Generating conversation summary", {
    messageCount: messages.length,
    model: currentModel,
  });

  try {
    // 使用 simpleChatWithModel 生成摘要（无工具调用）
    const summaryPrompt = `${COMPRESSION_PROMPT}\n\nPlease analyze the following conversation and provide the summary:\n\n${messages
      .filter(m => !(m instanceof SystemMessage))
      .map(m => {
        const role = m instanceof HumanMessage ? "User" : "Assistant";
        const content = typeof m.content === "string" ? m.content : extractTextContent(m.content);
        return `${role}: ${content}`;
      })
      .join("\n\n")}`;

    const summary = await simpleChatWithModel(
      [new HumanMessage(summaryPrompt)],
      currentModel
    );

    log.info("Summary generated", {
      summaryLength: summary.length,
    });

    return summary;
  } catch (error: any) {
    log.error("Failed to generate summary", { error: error.message });
    throw error;
  }
}

/**
 * 执行 compact 操作
 * 生成摘要，清除历史，并用摘要初始化新对话
 */
export async function compactWithSummary(): Promise<{ summary: string; messagesBefore: number }> {
  const state = await getState();
  const messages: BaseMessage[] = state.values?.messages || [];
  const messagesBefore = messages.length;

  if (messagesBefore === 0) {
    return { summary: "", messagesBefore: 0 };
  }

  // 生成摘要
  const summary = await generateSummary();

  // 创建新线程
  newThread();

  // 如果有摘要，添加到新对话中作为上下文
  if (summary) {
    // 直接向新线程添加摘要消息作为系统提示
    // 使用 "agent" 节点来更新状态（这是图中存在的节点）
    await graph.updateState(
      getRunConfig(),
      {
        messages: [
          new HumanMessage({
            content: `Previous Conversation Summary:\n${summary}\n\n[End of Summary - The conversation continues below]`,
            id: `compact_summary_${Date.now()}`,
          }),
        ],
      },
      "agent"
    );
  }

  log.info("Conversation compacted with summary", {
    messagesBefore,
    summaryLength: summary.length,
    newThreadId: currentThreadId,
  });

  return { summary, messagesBefore };
}

// 导出
export { graph, checkpointer };
