/**
 * 消息内存管理模块
 *
 * 实现消息裁剪和总结功能，替代硬性递归限制
 * 当上下文接近 token 限制时，自动总结早期消息
 */

import { BaseMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { getModelContextWindow } from "../config";

// Token 限制阈值（达到此比例时开始裁剪）
const TOKEN_TRIM_THRESHOLD = 0.7; // 70%

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
