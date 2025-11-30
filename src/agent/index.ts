import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
  MemorySaver,
  interrupt,
  Command,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, HumanMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { tools } from "../tools";
import { callOllamaWithTools } from "./ollama";
import { DEFAULT_MODEL, getModelConfig, supportsToolCalling } from "../config";
import { log } from "../logger";
import { ui } from "../ui";

// ============ 配置 ============

// 当前模型
let currentModel = DEFAULT_MODEL;

// 递归限制（防止无限循环）
const RECURSION_LIMIT = 25;

// 是否需要工具调用确认
let requireToolConfirmation = false;

// 敏感工具列表（需要确认的工具）
const SENSITIVE_TOOLS = ["Bash", "Write", "Edit"];

// ============ 模型管理 ============

export function setAgentModel(model: string): void {
  const oldModel = currentModel;
  currentModel = model;
  log.info("Model changed", { from: oldModel, to: model });
}

export function getAgentModel(): string {
  return currentModel;
}

// ============ 工具确认设置 ============

export function setToolConfirmation(enabled: boolean): void {
  requireToolConfirmation = enabled;
  log.info("Tool confirmation setting changed", { enabled });
}

export function getToolConfirmation(): boolean {
  return requireToolConfirmation;
}

// ============ Checkpointer (持久化) ============

// 使用 MemorySaver 实现对话持久化
const checkpointer = new MemorySaver();

// 当前线程 ID
let currentThreadId = `thread_${Date.now()}`;

export function setThreadId(threadId: string): void {
  currentThreadId = threadId;
}

export function getThreadId(): string {
  return currentThreadId;
}

export function newThread(): string {
  currentThreadId = `thread_${Date.now()}`;
  log.info("New thread created", { threadId: currentThreadId });
  return currentThreadId;
}

// ============ Graph 节点 ============

// Agent 节点 - 调用 LLM
const agentNode = async (
  state: typeof MessagesAnnotation.State,
  config?: RunnableConfig
) => {
  const startTime = Date.now();
  const modelConfig = getModelConfig(currentModel);
  const modelName = modelConfig?.model || currentModel;

  log.nodeStart("agent", state);
  log.agentThinking(modelName);

  // 检查递归限制
  const currentStep = (config?.metadata as any)?.langgraph_step || 0;
  if (currentStep >= RECURSION_LIMIT * 0.8) {
    log.warn("Approaching recursion limit", { step: currentStep, limit: RECURSION_LIMIT });
    ui.warn(`接近递归限制 (${currentStep}/${RECURSION_LIMIT})，将尝试直接回答`);
  }

  const response = await callOllamaWithTools(
    state.messages,
    supportsToolCalling(currentModel) ? tools : [],
    modelName,
    true
  );

  log.nodeEnd("agent", { messages: [response] }, Date.now() - startTime);

  return { messages: [response] };
};

// 工具确认节点 - 在执行敏感工具前请求确认
const toolConfirmationNode = async (state: typeof MessagesAnnotation.State) => {
  log.nodeStart("confirm_tools", state);
  const startTime = Date.now();

  const lastMessage = state.messages[state.messages.length - 1];

  if (!(lastMessage instanceof AIMessage) || !lastMessage.tool_calls?.length) {
    log.debug("No tool calls to confirm");
    return { messages: [] };
  }

  const sensitiveToolCalls = lastMessage.tool_calls.filter(
    tc => SENSITIVE_TOOLS.includes(tc.name)
  );

  if (sensitiveToolCalls.length === 0) {
    log.debug("No sensitive tools in tool calls");
    return { messages: [] };
  }

  log.info("Requesting tool confirmation", {
    sensitiveTools: sensitiveToolCalls.map(tc => tc.name),
    totalToolCalls: lastMessage.tool_calls.length,
  });

  // 显示需要确认的工具
  ui.warn("以下工具需要确认后执行:");
  sensitiveToolCalls.forEach((tc, i) => {
    ui.listItem(`${i + 1}. ${tc.name}(${JSON.stringify(tc.args).slice(0, 100)}...)`, 1);
  });

  // 使用 interrupt 等待用户确认
  log.info("Interrupting for user confirmation");
  const approved = interrupt({
    type: "tool_confirmation",
    tools: sensitiveToolCalls.map(tc => ({
      name: tc.name,
      args: tc.args,
    })),
    message: "是否执行这些工具？(y/n)",
  });

  if (approved === "y" || approved === "yes" || approved === true) {
    log.info("Tool execution approved", { tools: sensitiveToolCalls.map(tc => tc.name) });
    log.nodeEnd("confirm_tools", { approved: true }, Date.now() - startTime);
    return { messages: [] }; // 继续执行
  } else {
    log.info("Tool execution rejected", { tools: sensitiveToolCalls.map(tc => tc.name), userInput: approved });
    log.nodeEnd("confirm_tools", { approved: false }, Date.now() - startTime);
    // 返回取消消息
    return {
      messages: [
        new AIMessage({
          content: "工具执行已取消。",
        }),
      ],
    };
  }
};

// 创建工具节点
const toolNode = new ToolNode(tools);

// ============ 条件边 ============

// 判断是否需要调用工具
const shouldContinue = (
  state: typeof MessagesAnnotation.State
): "tools" | "confirm_tools" | typeof END => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  if (
    lastMessage instanceof AIMessage &&
    lastMessage.tool_calls &&
    lastMessage.tool_calls.length > 0
  ) {
    // 检查是否需要工具确认
    if (requireToolConfirmation) {
      const hasSensitiveTools = lastMessage.tool_calls.some(
        tc => SENSITIVE_TOOLS.includes(tc.name)
      );
      if (hasSensitiveTools) {
        log.conditionalEdge("agent", "shouldContinue", "confirm_tools");
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
  state: typeof MessagesAnnotation.State
): "tools" | typeof END => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  // 如果确认节点返回了取消消息，则结束
  if (
    lastMessage instanceof AIMessage &&
    lastMessage.content === "工具执行已取消。"
  ) {
    return END;
  }

  return "tools";
};

// ============ 构建 Graph ============

const graphBuilder = new StateGraph(MessagesAnnotation)
  .addNode("agent", agentNode)
  .addNode("confirm_tools", toolConfirmationNode)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue, {
    tools: "tools",
    confirm_tools: "confirm_tools",
    [END]: END,
  })
  .addConditionalEdges("confirm_tools", afterConfirmation, {
    tools: "tools",
    [END]: END,
  })
  .addEdge("tools", "agent");

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
    if (lastMsg instanceof AIMessage && lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
      log.info("Agent requesting tool calls", {
        toolCount: lastMsg.tool_calls.length,
        tools: lastMsg.tool_calls.map((tc: any) => tc.name),
      });
      ui.toolRequest(lastMsg.tool_calls.length, lastMsg.tool_calls.map((tc: any) => ({
        name: tc.name,
        args: tc.args,
      })));
    } else if (lastMsg instanceof AIMessage) {
      log.debug("Agent response (no tool calls)", {
        contentLength: typeof lastMsg.content === "string" ? lastMsg.content.length : 0,
      });
    }
  } else if (nodeName === "tools" && update.messages) {
    for (const msg of update.messages) {
      if (msg instanceof ToolMessage) {
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        const preview = content.length > 200 ? content.slice(0, 200) + "..." : content;
        log.info("Tool execution result", {
          tool: msg.name || "unknown",
          resultLength: content.length,
          preview: preview.slice(0, 100),
        });
        ui.toolResult(msg.name || "tool", preview);
      }
    }
  }
}

// ============ 核心执行方法 ============

// 获取运行配置
function getRunConfig(): RunnableConfig {
  return {
    configurable: {
      thread_id: currentThreadId,
    },
    recursionLimit: RECURSION_LIMIT,
  };
}

// 使用流式执行的核心方法
async function runGraphWithStream(
  input: { messages: BaseMessage[] } | null,
  config?: RunnableConfig
): Promise<BaseMessage[]> {
  const startTime = Date.now();
  const runConfig = { ...getRunConfig(), ...config };

  log.graphStart(input?.messages?.length || 0);
  log.info("Graph stream started", {
    threadId: currentThreadId,
    recursionLimit: RECURSION_LIMIT,
    inputType: input ? "messages" : "command",
  });

  const stream = await graph.stream(
    input,
    {
      ...runConfig,
      streamMode: "updates",
    }
  );

  let allMessages: BaseMessage[] = input?.messages ? [...input.messages] : [];
  let nodeCount = 0;

  for await (const chunk of stream) {
    for (const [nodeName, update] of Object.entries(chunk)) {
      nodeCount++;
      log.debug("Processing stream chunk", { nodeCount, nodeName });
      handleStreamUpdate(nodeName, update);

      if ((update as any).messages) {
        allMessages = [...allMessages, ...(update as any).messages];
      }
    }
  }

  const durationMs = Date.now() - startTime;
  log.graphEnd(allMessages.length, durationMs);
  log.info("Graph stream completed", {
    threadId: currentThreadId,
    totalMessages: allMessages.length,
    nodesExecuted: nodeCount,
    durationMs,
  });
  return allMessages;
}

// ============ 公共 API ============

// 单次聊天（不保存历史）
export async function chat(message: string): Promise<string> {
  log.info("Single chat started", { messageLength: message.length });
  log.userInput(message);

  try {
    const resultMessages = await runGraphWithStream({
      messages: [new HumanMessage(message)],
    });

    const lastMessage = resultMessages[resultMessages.length - 1];
    const response = lastMessage instanceof AIMessage
      ? lastMessage.content as string
      : String(lastMessage.content);

    log.info("Single chat completed", {
      responseLength: response.length,
      totalMessages: resultMessages.length,
    });
    return response;
  } catch (error: any) {
    log.error("Single chat failed", { error: error.message, stack: error.stack });
    throw error;
  }
}

// 多轮对话（使用 checkpointer 持久化）
export async function multiTurnChat(message: string): Promise<string> {
  log.info("Multi-turn chat started", {
    messageLength: message.length,
    threadId: currentThreadId,
  });
  log.userInput(message);

  try {
    const resultMessages = await runGraphWithStream({
      messages: [new HumanMessage(message)],
    });

    const lastMessage = resultMessages[resultMessages.length - 1];
    const response = lastMessage instanceof AIMessage
      ? lastMessage.content as string
      : String(lastMessage.content);

    log.info("Multi-turn chat completed", {
      responseLength: response.length,
      totalMessages: resultMessages.length,
      threadId: currentThreadId,
    });
    return response;
  } catch (error: any) {
    log.error("Multi-turn chat failed", { error: error.message, threadId: currentThreadId });
    throw error;
  }
}

// 恢复执行（用于 interrupt 后继续）
export async function resume(value: any): Promise<string> {
  log.info("Resuming execution after interrupt", {
    value,
    threadId: currentThreadId,
  });

  try {
    const resultMessages = await runGraphWithStream(
      new Command({ resume: value }) as any
    );

    const lastMessage = resultMessages[resultMessages.length - 1];
    const response = lastMessage instanceof AIMessage
      ? lastMessage.content as string
      : String(lastMessage.content);

    log.info("Resume completed", {
      responseLength: response.length,
      threadId: currentThreadId,
    });
    return response;
  } catch (error: any) {
    log.error("Resume failed", { error: error.message, threadId: currentThreadId });
    throw error;
  }
}

// 获取当前状态
export async function getState() {
  return await graph.getState(getRunConfig());
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
  ui.success("对话历史已清除，已创建新线程");
}

// 获取对话历史
export async function getHistory(): Promise<BaseMessage[]> {
  const state = await getState();
  return state.values?.messages || [];
}

// 导出
export { graph, checkpointer };
