/**
 * 统一聊天模型工厂
 *
 * 使用 LangChain 官方的聊天模型库实现对多种 LLM 提供商的支持
 * 支持: Anthropic, OpenAI, Ollama, OpenRouter (通过 OpenAI 兼容接口)
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import { StructuredToolInterface } from "@langchain/core/tools";
import { BaseMessage, AIMessageChunk } from "@langchain/core/messages";
import { concat } from "@langchain/core/utils/stream";
import { getModelConfig, ProviderType, ModelConfig } from "../config.js";
import { log } from "../logger.js";
import { ui } from "../ui.js";
import { autoTrimMessages, countMessageTokens } from "./memory.js";

// ============ Provider 配置 ============

// Anthropic
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || "";

// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "";

// OpenRouter (使用 OpenAI 兼容接口)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Ollama
const OLLAMA_BASE_URL = process.env.OLLAMA_HOST || "http://localhost:11434";

// ============ 模型工厂 ============

/**
 * 模型缓存，避免重复创建实例
 */
const modelCache = new Map<string, BaseChatModel>();

// 版本号
const VERSION = "1.0.0";

/**
 * 创建 Anthropic 聊天模型
 */
function createAnthropicModel(config: ModelConfig): BaseChatModel {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  log.debug("Creating Anthropic model", { model: config.model, baseURL: ANTHROPIC_BASE_URL || "default" });

  const options: any = {
    apiKey: ANTHROPIC_API_KEY,
    model: config.model,
    maxTokens: 16384,
    temperature: 0.7,
    clientOptions: {
      defaultHeaders: {
        "anthropic-beta": "interleaved-thinking-2025-05-14,output-128k-2025-02-19",
      },
    },
  };

  // 支持自定义 API 端点 (代理或兼容接口)
  if (ANTHROPIC_BASE_URL) {
    options.clientOptions = {
      ...options.clientOptions,
      baseURL: ANTHROPIC_BASE_URL,
    };
  }

  return new ChatAnthropic(options);
}

/**
 * 创建 OpenAI 聊天模型
 */
function createOpenAIModel(config: ModelConfig): BaseChatModel {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  log.debug("Creating OpenAI model", { model: config.model, baseURL: OPENAI_BASE_URL || "default" });

  const options: any = {
    apiKey: OPENAI_API_KEY,
    model: config.model,
    temperature: 0.7,
  };

  // 支持自定义 API 端点 (代理或兼容接口)
  if (OPENAI_BASE_URL) {
    options.configuration = {
      baseURL: OPENAI_BASE_URL,
    };
  }

  return new ChatOpenAI(options);
}

/**
 * 创建 OpenRouter 聊天模型 (通过 OpenAI 兼容接口)
 */
function createOpenRouterModel(config: ModelConfig): BaseChatModel {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  log.debug("Creating OpenRouter model", { model: config.model });

  return new ChatOpenAI({
    apiKey: OPENROUTER_API_KEY,
    model: config.model,
    temperature: 0.7,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/anthropics/claude-code",
        "X-Title": "hello-langchain",
      },
    },
  });
}

/**
 * 创建 Ollama 聊天模型
 */
function createOllamaModel(config: ModelConfig): BaseChatModel {
  log.debug("Creating Ollama model", { model: config.model, baseUrl: OLLAMA_BASE_URL });

  return new ChatOllama({
    baseUrl: OLLAMA_BASE_URL,
    model: config.model,
    temperature: 0.7,
  });
}

/**
 * 获取或创建聊天模型实例
 *
 * @param modelName 模型名称
 * @returns 聊天模型实例
 */
export function getChatModel(modelName: string): BaseChatModel {
  // 检查缓存
  if (modelCache.has(modelName)) {
    return modelCache.get(modelName)!;
  }

  const config = getModelConfig(modelName);
  if (!config) {
    throw new Error(`Unknown model: ${modelName}`);
  }

  let model: BaseChatModel;

  switch (config.provider) {
    case ProviderType.ANTHROPIC:
      model = createAnthropicModel(config);
      break;
    case ProviderType.OPENAI:
      model = createOpenAIModel(config);
      break;
    case ProviderType.OPENROUTER:
      model = createOpenRouterModel(config);
      break;
    case ProviderType.OLLAMA:
    default:
      model = createOllamaModel(config);
      break;
  }

  // 缓存模型实例
  modelCache.set(modelName, model);
  log.info("Chat model created", { name: modelName, provider: config.provider });

  return model;
}

/**
 * 清除模型缓存
 */
export function clearModelCache(): void {
  modelCache.clear();
  log.debug("Model cache cleared");
}

// ============ 聊天方法 ============

/**
 * 调用聊天模型 (支持工具调用和流式输出)
 *
 * @param messages 消息列表
 * @param tools 工具列表
 * @param modelName 模型名称
 * @param stream 是否流式输出
 * @returns AI 响应消息
 */
export async function callChatModel(
  messages: BaseMessage[],
  tools: StructuredToolInterface[],
  modelName: string,
  stream: boolean = true
): Promise<BaseMessage> {
  const startTime = Date.now();
  const config = getModelConfig(modelName);
  const resolvedModelName = config?.model || modelName;

  // 自动裁剪消息以适应上下文窗口
  const originalCount = messages.length;
  const originalTokens = countMessageTokens(messages);
  const trimmedMessages = autoTrimMessages(messages, modelName);

  if (trimmedMessages.length < originalCount) {
    const trimmedTokens = countMessageTokens(trimmedMessages);
    log.info("Messages trimmed to fit context window", {
      originalMessages: originalCount,
      trimmedMessages: trimmedMessages.length,
      removedMessages: originalCount - trimmedMessages.length,
      originalTokens,
      trimmedTokens,
      savedTokens: originalTokens - trimmedTokens,
    });
    ui.info(`Context trimmed: ${originalCount} → ${trimmedMessages.length} messages`);
  }

  log.llmStart(resolvedModelName, trimmedMessages.length, tools.length > 0);
  log.info("Chat model call initiated", {
    model: resolvedModelName,
    provider: config?.provider,
    messageCount: trimmedMessages.length,
    toolCount: tools.length,
    streamMode: stream,
  });

  const chatModel = getChatModel(modelName);

  // 绑定工具（如果有且模型支持）
  const modelWithTools = tools.length > 0 && chatModel.bindTools
    ? chatModel.bindTools(tools)
    : chatModel;

  // 记录请求详情
  log.debug("LLM Request", {
    model: resolvedModelName,
    provider: config?.provider,
    messageCount: trimmedMessages.length,
    messages: trimmedMessages.map((m, i) => ({
      index: i,
      type: m.constructor.name,
      contentPreview: typeof m.content === "string"
        ? m.content.slice(0, 200)
        : JSON.stringify(m.content).slice(0, 200),
    })),
    tools: tools.map(t => t.name),
  });

  try {
    if (stream) {
      ui.modelStart(resolvedModelName);

      const response = await modelWithTools.stream(trimmedMessages);
      let fullContent = "";
      let aggregatedMessage: AIMessageChunk | undefined = undefined;
      let chunkCount = 0;

      for await (const chunk of response) {
        chunkCount++;

        // 使用 concat 正确合并所有 chunks（包括 tool_calls）
        // 参考: https://github.com/langchain-ai/langgraph/discussions/2189
        aggregatedMessage = aggregatedMessage ? concat(aggregatedMessage, chunk) : chunk;

        // 提取内容 - 处理不同格式
        let chunkContent = "";
        if (typeof chunk.content === "string") {
          chunkContent = chunk.content;
        } else if (Array.isArray(chunk.content)) {
          // Anthropic 返回 content 数组格式: [{type: 'text', text: '...'}]
          for (const part of chunk.content) {
            if (typeof part === "string") {
              chunkContent += part;
            } else if (part && typeof part === "object" && "text" in part) {
              chunkContent += (part as any).text;
            }
          }
        }

        if (chunkContent) {
          ui.modelStream(chunkContent);
          fullContent += chunkContent;
        }

        // 记录每个 chunk 的详细信息（前10个）
        if (chunkCount <= 10) {
          log.debug("Stream chunk received", {
            chunkIndex: chunkCount,
            contentType: typeof chunk.content,
            isArray: Array.isArray(chunk.content),
            chunkContentLength: chunkContent.length,
            hasToolCalls: !!(chunk as any).tool_calls?.length,
            hasToolCallChunks: !!(chunk as any).tool_call_chunks?.length,
            rawContent: JSON.stringify(chunk.content).slice(0, 200),
          });
        }
      }

      if (fullContent) {
        ui.modelEnd();
      }

      const durationMs = Date.now() - startTime;
      log.llmEnd(resolvedModelName, durationMs, chunkCount);

      // 记录响应详情
      if (aggregatedMessage) {
        const toolCalls = aggregatedMessage.tool_calls || [];
        const toolCallChunks = (aggregatedMessage as any).tool_call_chunks || [];

        log.info("LLM Response", {
          model: resolvedModelName,
          provider: config?.provider,
          durationMs,
          chunkCount,
          contentLength: fullContent.length,
          contentPreview: fullContent.slice(0, 500),
          hasToolCalls: toolCalls.length > 0,
          toolCallsCount: toolCalls.length,
          toolCallChunksCount: toolCallChunks.length,
          toolCalls: toolCalls.map((tc: any) => ({
            id: tc.id,
            name: tc.name,
            argsPreview: JSON.stringify(tc.args).slice(0, 100),
          })),
        });

        // 确保内容正确设置
        if (fullContent) {
          (aggregatedMessage as any).content = fullContent;
        }

        return aggregatedMessage;
      }

      throw new Error("No response received from model");
    } else {
      // 非流式调用
      const response = await modelWithTools.invoke(trimmedMessages);
      const durationMs = Date.now() - startTime;

      // 提取内容
      let responseContent = "";
      if (typeof response.content === "string") {
        responseContent = response.content;
      } else if (Array.isArray(response.content)) {
        for (const part of response.content) {
          if (typeof part === "string") {
            responseContent += part;
          } else if (part && typeof part === "object" && "text" in part) {
            responseContent += (part as any).text;
          }
        }
      }

      const toolCalls = (response as any).tool_calls || [];

      log.llmEnd(resolvedModelName, durationMs, 0);
      log.info("LLM Response", {
        model: resolvedModelName,
        provider: config?.provider,
        durationMs,
        contentLength: responseContent.length,
        contentPreview: responseContent.slice(0, 500),
        hasToolCalls: toolCalls.length > 0,
        toolCalls: toolCalls.map((tc: any) => ({
          name: tc.name,
          argsPreview: JSON.stringify(tc.args).slice(0, 100),
        })),
      });

      return response;
    }
  } catch (error: any) {
    log.llmError(resolvedModelName, error.message);
    log.error("LLM call failed", {
      model: resolvedModelName,
      provider: config?.provider,
      error: error.message,
      errorBody: (error as any).body || (error as any).response?.data,
      statusCode: (error as any).status || (error as any).statusCode,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * 简单聊天 (无工具，流式)
 *
 * @param messages 消息列表
 * @param modelName 模型名称
 * @returns 响应文本
 */
export async function simpleChatWithModel(
  messages: BaseMessage[],
  modelName: string
): Promise<string> {
  const startTime = Date.now();
  const config = getModelConfig(modelName);
  const resolvedModelName = config?.model || modelName;

  // 自动裁剪消息
  const trimmedMessages = autoTrimMessages(messages, modelName);

  log.info("Simple chat started (no tools)", {
    model: resolvedModelName,
    messageCount: trimmedMessages.length,
  });

  ui.modelStart(resolvedModelName);

  const chatModel = getChatModel(modelName);

  try {
    const response = await chatModel.stream(trimmedMessages);
    let fullContent = "";
    let chunkCount = 0;

    for await (const chunk of response) {
      if (typeof chunk.content === "string" && chunk.content) {
        ui.modelStream(chunk.content);
        fullContent += chunk.content;
        chunkCount++;
      }
    }

    ui.modelEnd();

    const durationMs = Date.now() - startTime;
    log.info("Simple chat completed", {
      model: resolvedModelName,
      durationMs,
      chunkCount,
      contentLength: fullContent.length,
    });

    return fullContent;
  } catch (error: any) {
    ui.modelEnd();
    log.error("Simple chat failed", {
      model: resolvedModelName,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}
