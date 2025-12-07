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
import { isSafeModeEnabled, getPermissionMode, isToolAllowedInCurrentMode, PLAN_MODE_TOOLS } from "../settings.js";
import { callChatModel, simpleChatWithModel } from "./models.js";
import { getDefaultModel, getModelConfig, supportsToolCalling } from "../config.js";
import { log } from "../../logger.js";
import {
  shouldTrimMessages,
  shouldAutoCompact,
  buildSummaryPrompt,
  buildComprehensiveSummaryPrompt,
  countMessageTokens,
  getContextUsage,
  trimMessages,
} from "./memory.js";
import {
  generateContextInjection,
  wrapToolResult,
  generateTodoWriteHint,
} from "../context/index.js";
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
  emitDone,
  createToolAbortController,
  abortToolExecution,
  clearToolAbortController,
  setCurrentToolCallId,
  getCurrentToolCallId,
  clearToolCallIds,
} from "./events.js";

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
  const permissionMode = getPermissionMode();

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

  // Active skill instructions
  const skillRuntime = getSkillRuntime();
  const activeSkill = skillRuntime.getActiveSkill();
  const skillInstructions = activeSkill ? `

# ACTIVE SKILL: ${activeSkill.name.toUpperCase()}
${activeSkill.description}

${activeSkill.systemPrompt || ""}

## Tool Access
${activeSkill.tools === "*" ? "You have access to all available tools." : `Available tools: ${activeSkill.tools.join(", ")}`}
${activeSkill.readOnly ? "\n**This is a read-only skill. You CANNOT modify any files.**" : ""}
` : "";

  // Plan mode specific instructions
  const planModeInstructions = permissionMode === "plan" ? `

# PLAN MODE ACTIVE
You are currently in **PLAN MODE** - a research and planning mode for exploring and designing before implementation.

## Available Tools in Plan Mode

**Exploration (read-only):**
- Read, Glob, Grep, LS - explore the codebase
- WebSearch, WebFetch - research solutions online

**Planning (can write):**
- SavePlan - save your plan to a markdown file (.yterm/plan.md)
- ReadPlan - read a previously saved plan
- TodoWrite - manage task lists and track progress

**Control:**
- ExitPlanMode - exit plan mode when ready to implement

## You CANNOT:
- Edit or create source code files (use Write/Edit tools)
- Execute bash commands
- Modify the codebase directly

## Your Role in Plan Mode
1. Research the codebase to understand existing patterns
2. Analyze requirements and identify potential issues
3. Use TodoWrite to break down the task into steps
4. Use SavePlan to document your implementation plan
5. Use ExitPlanMode when ready to implement

When you have a complete plan, use the ExitPlanMode tool to return to normal mode with full tool access.
` : "";

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
${skillInstructions}${planModeInstructions}
gitStatus: This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.
${getGitStatus()}`;
}


// 敏感工具列表从 tools/types.ts 导入
// 注意: 权限检查现在使用 permissions.ts 中的 hasToolPermission

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
  const oldThreadId = currentThreadId;
  currentThreadId = `thread_${Date.now()}`;
  log.info("New thread created", { oldThreadId, newThreadId: currentThreadId });
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
  const permissionMode = getPermissionMode();

  log.nodeStart("agent", state);
  log.agentThinking(modelName);

  // Emit thinking event
  emitThinking(modelName);

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

// 追踪是否已经发射过确认事件（避免 resume 后重复发射）
let confirmationEmitted = false;

// 工具确认节点 - 在执行敏感工具前请求确认
const toolConfirmationNode = async (state: typeof MessagesAnnotation.State) => {
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
  } else if (response === "y" || response === "yes" || response === true) {
    // 向后兼容简单的 yes/no 响应
    log.info("Tool execution approved (simple)", { tools: toolsNeedingPermission.map(tc => tc.name) });
    log.nodeEnd("confirm_tools", { approved: true }, Date.now() - startTime);
    return { messages: [] };
  }

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
  log.info("Context limit approaching, generating summary...");

  // Emit compacting event to update UI
  const tokenCount = countMessageTokens(state.messages);
  emitCompacting(tokenCount);

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
    if (AIMessage.isInstance(msg) && msg.tool_calls && msg.tool_calls.length > 0) {
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

    log.info(`Summarized ${messagesToSummarize.length} messages`);

    // 发出 auto-compact 事件
    emitAutoCompact(
      state.messages.length,
      recentMessages.length + 1, // +1 for summary message
      summaryContent.slice(0, 500) // 摘要预览
    );

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
    log.error("Summary generation failed, continuing without summarization");
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
  state: typeof MessagesAnnotation.State
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
  state: typeof MessagesAnnotation.State
): "summarize" | "agent" => {
  const { messages } = state;
  const modelConfig = getModelConfig(currentModel);
  const modelName = modelConfig?.model || currentModel;

  // 获取上下文使用情况
  const contextUsage = getContextUsage(messages, modelName);

  // 检查是否需要 auto-compact（92% 阈值）
  if (contextUsage.isAboveAutoCompactThreshold) {
    log.conditionalEdge("check", "checkMessages", "summarize (auto-compact)");
    log.info("Auto-compact triggered: context usage above 92%", {
      messageCount: messages.length,
      tokens: contextUsage.tokenCount,
      percentUsed: contextUsage.percentUsed,
      contextLimit: contextUsage.contextLimit,
    });
    return "summarize";
  }

  // 检查是否需要普通总结（70% 阈值）
  if (shouldTrimMessages(messages, modelName)) {
    log.conditionalEdge("check", "checkMessages", "summarize");
    log.info("Messages exceed trim threshold, routing to summarize", {
      messageCount: messages.length,
      tokens: contextUsage.tokenCount,
      percentUsed: contextUsage.percentUsed,
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
    agent: "agent",  // pattern: 拒绝后路由到 agent 继续处理
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
    const msgToolCalls = AIMessage.isInstance(lastMsg) ? lastMsg.tool_calls : undefined;

    // First, emit any text content from the AI message
    // This handles cases where AI sends text before/after tool calls
    if (AIMessage.isInstance(lastMsg)) {
      const content = typeof lastMsg.content === "string" ? lastMsg.content : extractTextContent(lastMsg.content);
      if (content && content.trim()) {
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

    for (const msg of update.messages) {
      if (msg instanceof ToolMessage) {
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        const preview = content.length > 200 ? content.slice(0, 200) + "..." : content;
        log.info("Tool execution result", {
          tool: msg.name || "unknown",
          resultLength: content.length,
          preview: preview.slice(0, 100),
        });
        log.debug("Tool result", { tool: msg.name, preview });
        // Emit tool result event
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

  // 取消图执行
  if (currentAbortController && !currentAbortController.signal.aborted) {
    currentAbortController.abort();
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
  log.info("Multi-turn chat started", {
    messageLength: message.length,
    threadId: currentThreadId,
  });
  log.userInput(message);

  try {
    const result = await runGraphWithStream({
      messages: [new HumanMessage(message)],
    });

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

    // 更新状态 - 发送删除指令（使用 agent 节点）
    await graph.updateState(
      getRunConfig(),
      { messages: removeMessages },
      "agent"
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
