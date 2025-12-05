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
import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage, BaseMessage, ToolMessage, isAIMessage, RemoveMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { tools, getTodos } from "../tools/index.js";
import { callChatModel, simpleChatWithModel } from "./models.js";
import { DEFAULT_MODEL, getModelConfig, supportsToolCalling } from "../config.js";
import { log } from "../logger.js";
import { ui } from "../ui.js";
import {
  shouldTrimMessages,
  buildSummaryPrompt,
  countMessageTokens,
  trimMessages,
} from "./memory.js";
import {
  generateContextInjection,
  wrapToolResult,
  generateTodoWriteHint,
} from "../context/index.js";

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
let currentModel = DEFAULT_MODEL;

// 获取 Git 状态
function getGitStatus(): string {
  try {
    const { execSync } = require("child_process");
    const branch = execSync("git branch --show-current", { encoding: "utf-8", cwd: process.cwd() }).trim();
    const status = execSync("git status --short", { encoding: "utf-8", cwd: process.cwd() }).trim();
    const recentCommits = execSync("git log --oneline -5", { encoding: "utf-8", cwd: process.cwd() }).trim();
    return `Current branch: ${branch}\n\nStatus:\n${status || "(clean)"}\n\nRecent commits:\n${recentCommits}`;
  } catch {
    return "Git status unavailable";
  }
}

// 构建系统提示
function buildSystemPrompt(): string {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const osName = isWindows ? "Windows" : isMac ? "macOS" : "Linux";

  const windowsNotes = `- This is a Windows system. Use Windows commands instead of Unix commands:
  - Use \`cd\` instead of \`pwd\` to show current directory
  - Use \`dir\` instead of \`ls\` to list files
  - Use \`type\` instead of \`cat\` to display file contents
  - Use \`copy\` instead of \`cp\`, \`move\` instead of \`mv\`, \`del\` instead of \`rm\`
  - Use \`rmdir /s /q\` instead of \`rm -rf\`
- Or use PowerShell commands (e.g., \`Get-Location\`, \`Get-ChildItem\`)
- Path separator is backslash (\\\\) but forward slash (/) often works too`;

  const unixNotes = `- This is a Unix-like system. Standard Unix commands are available.
- Shell: ${process.env.SHELL || "/bin/bash"}`;

  return `You are Claude Code, Anthropic's official CLI for Claude.
You are an interactive CLI tool that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.

# Tone and style
- Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.
- Your output will be displayed on a command line interface. Your responses should be short and concise. You can use Github-flavored markdown for formatting.
- Output text to communicate with the user; all text you output outside of tool use is displayed to the user. Only use tools to complete tasks. Never use tools like Bash or code comments as means to communicate with the user during the session.
- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one. This includes markdown files.

# Professional objectivity
Prioritize technical accuracy and truthfulness over validating the user's beliefs. Focus on facts and problem-solving, providing direct, objective technical info without any unnecessary superlatives, praise, or emotional validation. It is best for the user if Claude honestly applies the same rigorous standards to all ideas and disagrees when necessary, even if it may not be what the user wants to hear.

# Task Management
You have access to the TodoWrite tool to help you manage and plan tasks. Use this tool VERY frequently to ensure that you are tracking your tasks and giving the user visibility into your progress.
These tools are also EXTREMELY helpful for planning tasks, and for breaking down larger complex tasks into smaller steps. If you do not use this tool when planning, you may forget to do important tasks - and that is unacceptable.

It is critical that you mark todos as completed as soon as you are done with a task. Do not batch up multiple tasks before marking them as completed.

# Doing tasks
The user will primarily request you perform software engineering tasks. This includes solving bugs, adding new functionality, refactoring code, explaining code, and more. For these tasks the following steps are recommended:
- Use the TodoWrite tool to plan the task if required
- NEVER propose changes to code you haven't read. If a user asks about or wants you to modify a file, read it first. Understand existing code before suggesting modifications.
- Be careful not to introduce security vulnerabilities such as command injection, XSS, SQL injection, and other OWASP top 10 vulnerabilities. If you notice that you wrote insecure code, immediately fix it.
- Avoid over-engineering. Only make changes that are directly requested or clearly necessary. Keep solutions simple and focused.

# Tool usage policy
- You can call multiple tools in a single response. If you intend to call multiple tools and there are no dependencies between them, make all independent tool calls in parallel. Maximize use of parallel tool calls where possible to increase efficiency.
- Use specialized tools instead of bash commands when possible. For file operations, use dedicated tools: Read for reading files instead of cat/head/tail, Edit for editing instead of sed/awk, and Write for creating files instead of cat with heredoc or echo redirection. Reserve bash tools exclusively for actual system commands and terminal operations that require shell execution.
- NEVER use bash echo or other command-line tools to communicate thoughts, explanations, or instructions to the user. Output all communication directly in your response text instead.

# Environment Information
<env>
Working directory: ${process.cwd()}
Is directory a git repo: Yes
Platform: ${process.platform}
Today's date: ${new Date().toISOString().split("T")[0]}
</env>

# Important Notes for ${osName}
${isWindows ? windowsNotes : unixNotes}

gitStatus: This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.
${getGitStatus()}`;
}

// 递归限制（设置一个较高的值作为安全网，主要依赖 token 管理）
// 由于我们现在使用 token 管理来控制上下文，递归限制只是最后的保护
const RECURSION_LIMIT = 200;

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
  _config?: RunnableConfig
) => {
  const startTime = Date.now();
  const modelConfig = getModelConfig(currentModel);
  const modelName = modelConfig?.model || currentModel;

  log.nodeStart("agent", state);
  log.agentThinking(modelName);

  // 获取可用工具
  const availableTools = supportsToolCalling(currentModel) ? tools : [];

  // 准备消息列表：如果没有系统消息，添加系统提示
  let messagesWithSystem = [...state.messages];
  const hasSystemMessage = state.messages.some(m => m instanceof SystemMessage);
  if (!hasSystemMessage) {
    // 延迟构建系统提示，确保环境信息是最新的
    const systemPrompt = buildSystemPrompt();
    messagesWithSystem = [new SystemMessage(systemPrompt), ...messagesWithSystem];
  }

  // 注入上下文到最后一条用户消息（CLAUDE.md、todo 列表等）
  const contextInjection = generateContextInjection();
  if (contextInjection) {
    // 找到最后一条用户消息并注入上下文
    for (let i = messagesWithSystem.length - 1; i >= 0; i--) {
      const msg = messagesWithSystem[i];
      if (msg instanceof HumanMessage) {
        const originalContent = typeof msg.content === "string" ? msg.content : String(msg.content);
        messagesWithSystem[i] = new HumanMessage(originalContent + "\n" + contextInjection);
        log.debug("Context injected into user message", { contextLength: contextInjection.length });
        break;
      }
    }
  }

  // 使用统一的聊天模型接口
  const response = await callChatModel(messagesWithSystem, availableTools, currentModel, true);

  log.nodeEnd("agent", { messages: [response] }, Date.now() - startTime);

  return { messages: [response] };
};

// 工具确认节点 - 在执行敏感工具前请求确认
const toolConfirmationNode = async (state: typeof MessagesAnnotation.State) => {
  log.nodeStart("confirm_tools", state);
  const startTime = Date.now();

  const lastMessage = state.messages[state.messages.length - 1];
  const toolCalls = isAIMessage(lastMessage) ? lastMessage.tool_calls : undefined;

  if (!toolCalls?.length) {
    log.debug("No tool calls to confirm");
    return { messages: [] };
  }

  const sensitiveToolCalls = toolCalls.filter(
    tc => SENSITIVE_TOOLS.includes(tc.name)
  );

  if (sensitiveToolCalls.length === 0) {
    log.debug("No sensitive tools in tool calls");
    return { messages: [] };
  }

  log.info("Requesting tool confirmation", {
    sensitiveTools: sensitiveToolCalls.map(tc => tc.name),
    totalToolCalls: toolCalls.length,
  });

  // 显示需要确认的工具
  ui.warn("以下工具需要确认后执行:");
  sensitiveToolCalls.forEach((tc, i) => {
    ui.listItem(`${i + 1}. ${tc.name}(${JSON.stringify(tc.args).slice(0, 100)}...)`);
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

// 总结节点 - 当消息历史过长时使用 LLM 生成总结
// 按照 LangGraph 官方推荐：使用 RemoveMessage 删除旧消息，保留摘要
const summarizeNode = async (
  state: typeof MessagesAnnotation.State,
  _config?: RunnableConfig
) => {
  const startTime = Date.now();
  const modelConfig = getModelConfig(currentModel);
  const modelName = modelConfig?.model || currentModel;

  log.nodeStart("summarize", state);
  ui.info("Context limit approaching, generating summary...");

  // 分离系统消息和其他消息
  const systemMessages = state.messages.filter(m => m instanceof SystemMessage);
  const nonSystemMessages = state.messages.filter(m => !(m instanceof SystemMessage));

  // 保留最近的消息（确保工具调用完整性）
  const keepCount = 10;

  // 找到安全的分割点 - 确保不会打断工具调用对
  let splitIndex = Math.max(0, nonSystemMessages.length - keepCount);

  // 向前调整分割点，确保不在 AIMessage(tool_calls) 之后立即切断
  while (splitIndex > 0) {
    const msg = nonSystemMessages[splitIndex - 1];
    // 如果前一条是带 tool_calls 的 AIMessage，需要保留对应的 ToolMessage
    if (isAIMessage(msg) && msg.tool_calls && msg.tool_calls.length > 0) {
      splitIndex--;
    } else {
      break;
    }
  }

  const messagesToSummarize = nonSystemMessages.slice(0, splitIndex);
  const recentMessages = nonSystemMessages.slice(splitIndex);

  if (messagesToSummarize.length === 0) {
    log.debug("No messages to summarize");
    return { messages: [] };
  }

  // 构建总结 prompt
  const summaryPrompt = buildSummaryPrompt(messagesToSummarize);

  log.info("Generating summary with LLM", {
    messagesToSummarize: messagesToSummarize.length,
    recentMessages: recentMessages.length,
    model: modelName,
  });

  try {
    // 使用统一的聊天模型接口（不带工具）
    const summaryContent = await simpleChatWithModel(
      [new HumanMessage(summaryPrompt)],
      currentModel
    );

    // 创建摘要消息（使用 HumanMessage 作为上下文提示，避免与 AI 响应混淆）
    const summaryMessage = new HumanMessage({
      content: `[Previous Conversation Summary]\n${summaryContent}\n[End of Summary - The conversation continues below]`,
      id: `summary_${Date.now()}`,
    });

    // 使用 RemoveMessage 删除被总结的旧消息
    // LangGraph 的 add_messages reducer 会处理这些删除操作
    const removeMessages = messagesToSummarize
      .filter(m => m.id) // 只删除有 id 的消息
      .map(m => new RemoveMessage({ id: m.id! }));

    log.info("Summary generated", {
      summaryLength: summaryContent.length,
      removedMessages: removeMessages.length,
      keptMessages: recentMessages.length,
      durationMs: Date.now() - startTime,
    });

    ui.success(`Summarized ${messagesToSummarize.length} messages`);

    log.nodeEnd("summarize", {
      summaryMessage: true,
      removedCount: removeMessages.length
    }, Date.now() - startTime);

    // 返回：先添加摘要消息，再发送删除指令
    // LangGraph 的 MessagesAnnotation 会按顺序处理这些操作
    return {
      messages: [summaryMessage, ...removeMessages]
    };
  } catch (error: any) {
    log.error("Failed to generate summary", { error: error.message });
    log.nodeEnd("summarize", { error: error.message }, Date.now() - startTime);
    ui.error("Summary generation failed, continuing without summarization");
    return { messages: [] };
  }
};

// ============ 条件边 ============

// 判断是否需要调用工具
const shouldContinue = (
  state: typeof MessagesAnnotation.State
): "tools" | "confirm_tools" | typeof END => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  // 使用 isAIMessage 来检查，它同时支持 AIMessage 和 AIMessageChunk
  // 参考: https://js.langchain.com/docs/how_to/tool_calling/
  const toolCalls = isAIMessage(lastMessage) ? lastMessage.tool_calls : undefined;

  log.debug("shouldContinue check", {
    lastMessageType: lastMessage?.constructor?.name,
    isAIMessage: isAIMessage(lastMessage),
    hasToolCalls: !!(toolCalls && toolCalls.length > 0),
    toolCallsCount: toolCalls?.length || 0,
  });

  if (toolCalls && toolCalls.length > 0) {
    // 检查是否需要工具确认
    if (requireToolConfirmation) {
      const hasSensitiveTools = toolCalls.some(
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
    isAIMessage(lastMessage) &&
    lastMessage.content === "工具执行已取消。"
  ) {
    return END;
  }

  return "tools";
};

// 检查消息点 - 在进入 agent 之前检查是否需要总结
const checkMessages = (
  state: typeof MessagesAnnotation.State
): "summarize" | "agent" => {
  const { messages } = state;
  const modelConfig = getModelConfig(currentModel);
  const modelName = modelConfig?.model || currentModel;

  // 检查是否需要总结
  if (shouldTrimMessages(messages, modelName)) {
    log.conditionalEdge("check", "checkMessages", "summarize");
    log.info("Messages exceed threshold, routing to summarize", {
      messageCount: messages.length,
      tokens: countMessageTokens(messages),
    });
    return "summarize";
  }

  log.conditionalEdge("check", "checkMessages", "agent");
  return "agent";
};

// ============ 构建 Graph ============

const graphBuilder = new StateGraph(MessagesAnnotation)
  .addNode("agent", agentNode)
  .addNode("confirm_tools", toolConfirmationNode)
  .addNode("tools", toolNode)
  .addNode("summarize", summarizeNode)
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
  // 工具执行后检查是否需要总结
  .addConditionalEdges("tools", checkMessages, {
    summarize: "summarize",
    agent: "agent",
  })
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
    const msgToolCalls = isAIMessage(lastMsg) ? lastMsg.tool_calls : undefined;
    if (msgToolCalls && msgToolCalls.length > 0) {
      log.info("Agent requesting tool calls", {
        toolCount: msgToolCalls.length,
        tools: msgToolCalls.map((tc: any) => tc.name),
      });
      ui.toolsSummary(msgToolCalls.map((tc: any) => ({
        name: tc.name,
        args: tc.args,
      })));
    } else if (isAIMessage(lastMsg)) {
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
    const response = isAIMessage(lastMessage)
      ? (typeof lastMessage.content === "string" ? lastMessage.content : extractTextContent(lastMessage.content))
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
    const response = isAIMessage(lastMessage)
      ? (typeof lastMessage.content === "string" ? lastMessage.content : extractTextContent(lastMessage.content))
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
    const response = isAIMessage(lastMessage)
      ? (typeof lastMessage.content === "string" ? lastMessage.content : extractTextContent(lastMessage.content))
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

// 压缩对话历史（手动触发）
// 使用 RemoveMessage 来删除旧消息，保持与 summarizeNode 一致
export async function compactHistory(): Promise<{ before: number; after: number }> {
  const state = await getState();
  const messages: BaseMessage[] = state.values?.messages || [];

  if (messages.length === 0) {
    return { before: 0, after: 0 };
  }

  const trimmedMessages = trimMessages(messages, currentModel);

  if (trimmedMessages.length < messages.length) {
    // 找出需要删除的消息
    const trimmedIds = new Set(trimmedMessages.map(m => m.id).filter(Boolean));
    const messagesToRemove = messages.filter(m => m.id && !trimmedIds.has(m.id));

    // 使用 RemoveMessage 来删除旧消息
    const removeMessages = messagesToRemove.map(m => new RemoveMessage({ id: m.id! }));

    // 更新状态 - 发送删除指令
    await graph.updateState(
      getRunConfig(),
      { messages: removeMessages },
      "compact"
    );

    log.info("History compacted manually using RemoveMessage", {
      before: messages.length,
      after: trimmedMessages.length,
      removed: messagesToRemove.length,
    });
  }

  return {
    before: messages.length,
    after: trimmedMessages.length,
  };
}

// 导出
export { graph, checkpointer };
