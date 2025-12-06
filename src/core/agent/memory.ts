/**
 * 消息内存管理模块
 *
 * 实现消息裁剪和总结功能，替代硬性递归限制
 * 当上下文接近 token 限制时，自动总结早期消息
 * 
 */

import { BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { getModelContextWindow } from "../config.js";
import { log } from "../../logger.js";

// Token 限制阈值（达到此比例时开始裁剪）
const TOKEN_TRIM_THRESHOLD = 0.7; // 70% - 用于普通裁剪

// Auto-compact 阈值（达到此比例时触发自动压缩）
const AUTO_COMPACT_THRESHOLD = 0.92; // 92%

// 保留最近的消息数量（不会被裁剪）
const KEEP_RECENT_MESSAGES = 10;

// 最大工具结果长度
const MAX_TOOL_RESULT_LENGTH = 10000;

// ============ Token 计数 ============

/**
 * 简单的 token 计数器
 *
 * 注意：这是一个近似估算，实际 token 数可能因模型而异
 * 中文大约 1.5-2 字符/token，英文大约 4 字符/token
 *
 * @param text 文本内容
 * @returns 估算的 token 数
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // 分离中英文
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;

  // 中文约 1.5 字符/token，英文约 4 字符/token
  const chineseTokens = Math.ceil(chineseChars / 1.5);
  const otherTokens = Math.ceil(otherChars / 4);

  return chineseTokens + otherTokens;
}

/**
 * 计算消息数组的总 token 数
 *
 * @param messages 消息数组
 * @returns 估算的总 token 数
 */
export function countMessageTokens(messages: BaseMessage[]): number {
  let totalTokens = 0;

  for (const msg of messages) {
    // 基础开销（role, 格式等）
    const overhead = 4;

    // 内容 token
    const content = typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content);
    const contentTokens = estimateTokens(content);

    // 工具调用的额外 token
    let toolTokens = 0;
    if (msg instanceof AIMessage && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        toolTokens += estimateTokens(tc.name);
        toolTokens += estimateTokens(JSON.stringify(tc.args));
        toolTokens += 10; // 工具调用格式开销
      }
    }

    totalTokens += overhead + contentTokens + toolTokens;
  }

  return totalTokens;
}

/**
 * LangChain 兼容的 token 计数器
 * 用于 trimMessages 函数
 */
export function tokenCounter(messages: BaseMessage[]): number {
  return countMessageTokens(messages);
}

// ============ 消息总结 ============

/**
 * 将消息转换为可读文本格式（用于 LLM 总结）
 */
function messagesToText(messages: BaseMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    if (msg instanceof HumanMessage) {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      lines.push(`用户: ${content}`);
    } else if (msg instanceof AIMessage) {
      if (msg.tool_calls?.length) {
        const toolNames = msg.tool_calls.map(tc => tc.name).join(", ");
        lines.push(`助手: [调用工具: ${toolNames}]`);
      } else {
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        lines.push(`助手: ${content}`);
      }
    } else if (msg instanceof ToolMessage) {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      // 工具结果可能很长，截取前 500 字符
      const preview = content.length > 500 ? content.slice(0, 500) + "..." : content;
      lines.push(`工具[${msg.name}]结果: ${preview}`);
    }
  }

  return lines.join("\n\n");
}


/**
 * 构建 LLM 总结的 prompt
 *
 * @param messages 需要总结的消息
 * @returns 用于 LLM 的 prompt
 */
export function buildSummaryPrompt(messages: BaseMessage[]): string {
  const conversationText = messagesToText(messages);

  // 限制输入长度
  const maxInputLength = 4000;
  const truncatedText = conversationText.length > maxInputLength
    ? conversationText.slice(0, maxInputLength) + "\n...(已截断)"
    : conversationText;

  return `请用简洁的中文总结以下对话内容，保留关键信息：
- 用户的主要问题或请求
- 助手执行的主要操作
- 重要的结果或发现
总结应该在 200 字以内。

对话内容：
${truncatedText}`;
}

/**
 * 构建用于自动压缩的综合总结 prompt
 *
 * @param messages 需要总结的消息
 * @returns 用于 LLM 的 prompt
 */
export function buildComprehensiveSummaryPrompt(messages: BaseMessage[]): string {
  const conversationText = messagesToText(messages);

  // 限制输入长度
  const maxInputLength = 8000;
  const truncatedText = conversationText.length > maxInputLength
    ? conversationText.slice(0, maxInputLength) + "\n...(已截断)"
    : conversationText;

  return `Please provide a comprehensive summary of our conversation structured as follows:

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

Focus on information essential for continuing the conversation effectively, including specific details about code, files, errors, and plans.

Conversation:
${truncatedText}`;
}

// ============ 消息检查 ============

/**
 * 检查是否需要裁剪消息
 *
 * @param messages 消息数组
 * @param modelName 模型名称
 * @returns 是否需要裁剪
 */
export function shouldTrimMessages(messages: BaseMessage[], modelName: string): boolean {
  const contextLimit = getModelContextWindow(modelName);
  const trimThreshold = Math.floor(contextLimit * TOKEN_TRIM_THRESHOLD);
  const currentTokens = countMessageTokens(messages);

  return currentTokens > trimThreshold;
}

// ============ 消息裁剪 ============

/**
 * 截断过长的工具结果
 */
function truncateToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_LENGTH) {
    return content;
  }

  // 保留前后部分
  const halfLength = Math.floor(MAX_TOOL_RESULT_LENGTH / 2);
  const head = content.slice(0, halfLength);
  const tail = content.slice(-halfLength);

  return `${head}\n\n... [truncated ${content.length - MAX_TOOL_RESULT_LENGTH} characters] ...\n\n${tail}`;
}

/**
 * 压缩消息 - 截断过长的工具结果
 */
function compressMessage(msg: BaseMessage): BaseMessage {
  if (msg instanceof ToolMessage) {
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    if (content.length > MAX_TOOL_RESULT_LENGTH) {
      return new ToolMessage({
        content: truncateToolResult(content),
        tool_call_id: msg.tool_call_id,
        name: msg.name,
      });
    }
  }
  return msg;
}

/**
 * 裁剪消息以适应上下文窗口
 *
 * 策略：
 * 1. 保留系统消息
 * 2. 保留最近 N 条消息
 * 3. 压缩工具结果
 * 4. 移除较早的消息
 *
 * @param messages 消息数组
 * @param modelName 模型名称
 * @returns 裁剪后的消息数组
 */
export function trimMessages(messages: BaseMessage[], modelName: string): BaseMessage[] {
  const contextLimit = getModelContextWindow(modelName);
  const maxTokens = Math.floor(contextLimit * TOKEN_TRIM_THRESHOLD);

  // 分离系统消息
  const systemMessages = messages.filter(m => m instanceof SystemMessage);
  const nonSystemMessages = messages.filter(m => !(m instanceof SystemMessage));

  // 压缩所有消息中的工具结果
  let compressedMessages = nonSystemMessages.map(compressMessage);

  // 计算系统消息的 token
  const systemTokens = countMessageTokens(systemMessages);
  const availableTokens = maxTokens - systemTokens;

  if (availableTokens <= 0) {
    log.warn("System messages exceed token limit");
    return [...systemMessages, ...compressedMessages.slice(-KEEP_RECENT_MESSAGES)];
  }

  // 保留最近的消息
  const recentMessages = compressedMessages.slice(-KEEP_RECENT_MESSAGES);
  const olderMessages = compressedMessages.slice(0, -KEEP_RECENT_MESSAGES);

  let recentTokens = countMessageTokens(recentMessages);
  let remainingTokens = availableTokens - recentTokens;

  // 如果最近消息就超过了限制，需要进一步裁剪
  if (remainingTokens < 0) {
    log.warn("Recent messages exceed token limit, truncating further");

    // 保留尽可能多的最近消息
    let kept: BaseMessage[] = [];
    let tokens = 0;

    for (let i = compressedMessages.length - 1; i >= 0; i--) {
      const msgTokens = countMessageTokens([compressedMessages[i]]);
      if (tokens + msgTokens <= availableTokens) {
        kept.unshift(compressedMessages[i]);
        tokens += msgTokens;
      } else {
        break;
      }
    }

    log.info("Messages trimmed", {
      original: messages.length,
      kept: kept.length,
      removedCount: messages.length - kept.length - systemMessages.length,
    });

    return [...systemMessages, ...kept];
  }

  // 从旧消息中保留尽可能多的内容
  let keptOlder: BaseMessage[] = [];
  let olderTokens = 0;

  for (const msg of olderMessages) {
    const msgTokens = countMessageTokens([msg]);
    if (olderTokens + msgTokens <= remainingTokens) {
      keptOlder.push(msg);
      olderTokens += msgTokens;
    } else {
      break;
    }
  }

  const finalMessages = [...systemMessages, ...keptOlder, ...recentMessages];

  if (keptOlder.length < olderMessages.length) {
    log.info("Messages trimmed", {
      original: messages.length,
      kept: finalMessages.length,
      removedCount: olderMessages.length - keptOlder.length,
    });

    // 在裁剪点添加一个摘要提示
    if (keptOlder.length > 0 || olderMessages.length > 0) {
      const removedCount = olderMessages.length - keptOlder.length;
      const summaryNote = new HumanMessage({
        content: `[Previous ${removedCount} messages have been removed to fit context window. The conversation continues from here.]`,
      });

      return [...systemMessages, summaryNote, ...keptOlder, ...recentMessages];
    }
  }

  return finalMessages;
}

/**
 * 自动裁剪消息（在调用 LLM 之前使用）
 */
export function autoTrimMessages(messages: BaseMessage[], modelName: string): BaseMessage[] {
  if (!shouldTrimMessages(messages, modelName)) {
    return messages;
  }

  log.info("Auto-trimming messages", {
    messageCount: messages.length,
    estimatedTokens: countMessageTokens(messages),
    modelName,
  });

  return trimMessages(messages, modelName);
}

// ============ Auto-Compact============

/**
 * 检查是否需要 auto-compact
 * 当 token 使用超过 92% 时触发
 */
export function shouldAutoCompact(messages: BaseMessage[], modelName: string): boolean {
  if (messages.length < 3) return false;

  const contextLimit = getModelContextWindow(modelName);
  const autoCompactThreshold = Math.floor(contextLimit * AUTO_COMPACT_THRESHOLD);
  const currentTokens = countMessageTokens(messages);

  return currentTokens >= autoCompactThreshold;
}

/**
 * 计算上下文使用情况
 */
export function getContextUsage(messages: BaseMessage[], modelName: string): {
  tokenCount: number;
  contextLimit: number;
  percentUsed: number;
  isAboveAutoCompactThreshold: boolean;
  tokensRemaining: number;
} {
  const contextLimit = getModelContextWindow(modelName);
  const tokenCount = countMessageTokens(messages);
  const autoCompactThreshold = contextLimit * AUTO_COMPACT_THRESHOLD;

  return {
    tokenCount,
    contextLimit,
    percentUsed: Math.round((tokenCount / contextLimit) * 100),
    isAboveAutoCompactThreshold: tokenCount >= autoCompactThreshold,
    tokensRemaining: Math.max(0, autoCompactThreshold - tokenCount),
  };
}

/**
 * 导出常量供其他模块使用
 */
export const MEMORY_CONSTANTS = {
  TOKEN_TRIM_THRESHOLD,
  AUTO_COMPACT_THRESHOLD,
  KEEP_RECENT_MESSAGES,
  MAX_TOOL_RESULT_LENGTH,
};
