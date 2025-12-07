/**
 * 消息内存管理模块
 *
 * 实现消息裁剪和总结功能，替代硬性递归限制
 * 当上下文接近 token 限制时，自动总结早期消息
 * 
 */

import { BaseMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { getModelContextWindow } from "../config.js";

// Auto-compact 阈值（达到此比例时触发自动压缩）
const AUTO_COMPACT_THRESHOLD = 0.92; // 92%

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
 * 构建用于自动压缩的综合总结 prompt
 *
 * @param messages 需要总结的消息
 * @returns 用于 LLM 的 prompt
 */
export function buildComprehensiveSummaryPrompt(messages: BaseMessage[]): string {
  const conversationText = messagesToText(messages);

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
${conversationText}`;
}

// ============ Auto-Compact ============

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

export const MEMORY_CONSTANTS = {
  AUTO_COMPACT_THRESHOLD,
};
