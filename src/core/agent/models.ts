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
import { getModelConfig, ProviderType, ModelType, ModelConfig } from "../config.js";
import { log } from "../../logger.js";
import { autoTrimMessages, countMessageTokens } from "./memory.js";
import { emitStreaming } from "./events.js";

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
        "HTTP-Referer": "https://github.com/HeiSir2014/hello-langchain",
        "X-Title": "YTerm",
      },
    },
  });
}

/**
 * 检查模型是否支持 thinking（深度推理）功能
 * DeepSeek 系列模型支持 thinking 输出
 */
function supportsThinking(modelName: string): boolean {
  const thinkingModels = [
    "deepseek",     // DeepSeek 系列
    "qwq",          // Qwen QwQ 推理模型
    "o1",           // OpenAI o1 系列（如果通过 Ollama）
    "r1",           // DeepSeek R1
  ];
  const lowerName = modelName.toLowerCase();
  return thinkingModels.some(m => lowerName.includes(m));
}

/**
 * 创建 Ollama 聊天模型
 *
 * 支持本地和云端两种模式：
 * - 本地模型：使用 OLLAMA_HOST (默认 http://localhost:11434)
 * - 云端模型：使用 OLLAMA_CLOUD_HOST 和 OLLAMA_CLOUD_API_KEY
 *
 * 云端模型的判断优先级：
 * 1. config.type === ModelType.CLOUD（动态获取的模型配置）
 * 2. 模型名称包含 "-cloud" 后缀（兼容旧配置）
 */
function createOllamaModel(config: ModelConfig): BaseChatModel {
  // 判断是否是云端模型
  // 优先使用 config.type（从 Ollama API 动态获取时已设置）
  // 兼容旧的 "-cloud" 后缀命名规则
  const isCloudModel = config.type === ModelType.CLOUD || config.model.includes("-cloud");

  // 获取云端配置
  const OLLAMA_CLOUD_HOST = process.env.OLLAMA_CLOUD_HOST || "https://ollama.com";
  const OLLAMA_CLOUD_API_KEY = process.env.OLLAMA_CLOUD_API_KEY || process.env.OLLAMA_API_KEY || "";

  // 根据模型类型选择地址
  const baseUrl = isCloudModel ? OLLAMA_CLOUD_HOST : OLLAMA_BASE_URL;

  // 检查是否支持 thinking 功能
  const enableThinking = supportsThinking(config.model);

  log.debug("Creating Ollama model", {
    model: config.model,
    baseUrl,
    isCloudModel,
    supportsTools: config.supportsTools,
    enableThinking,
  });

  // 警告：云端模型但没有配置 API Key
  if (isCloudModel && !OLLAMA_CLOUD_API_KEY) {
    log.warn("OLLAMA_CLOUD_API_KEY not configured for cloud model", { model: config.model });
  }

  // 构建 ChatOllama 配置
  const ollamaOptions: any = {
    baseUrl,
    model: config.model,
    temperature: 0.7,
    // 为支持 thinking 的模型启用 think 参数
    // 这会让 @langchain/ollama 优先读取 thinking 字段的内容
    think: enableThinking,
  };

  // 云端模型需要 API Key 认证
  // 参考: https://docs.ollama.com/api/authentication
  if (isCloudModel && OLLAMA_CLOUD_API_KEY) {
    ollamaOptions.headers = {
      "Authorization": `Bearer ${OLLAMA_CLOUD_API_KEY}`,
    };
  }

  return new ChatOllama(ollamaOptions);
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
    log.info(`Context trimmed: ${originalCount} → ${trimmedMessages.length} messages`);
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
      log.debug("Model stream started", { model: resolvedModelName });

      const response = await modelWithTools.stream(trimmedMessages);
      let fullContent = "";
      let aggregatedMessage: AIMessageChunk | undefined = undefined;
      let chunkCount = 0;

      for await (const chunk of response) {
        chunkCount++;

        // 使用 concat 正确合并所有 chunks（包括 tool_calls）
        // 参考: https://github.com/langchain-ai/langgraph/discussions/2189
        aggregatedMessage = aggregatedMessage ? concat(aggregatedMessage, chunk) : chunk;

        // 提取内容 - 处理不同模型的响应格式
        let chunkContent = "";

        // 1. 标准 string 格式
        if (typeof chunk.content === "string" && chunk.content) {
          chunkContent = chunk.content;
        }
        // 2. Anthropic 返回 content 数组格式: [{type: 'text', text: '...'}]
        else if (Array.isArray(chunk.content)) {
          for (const part of chunk.content) {
            if (typeof part === "string") {
              chunkContent += part;
            } else if (part && typeof part === "object" && "text" in part) {
              chunkContent += (part as any).text;
            }
          }
        }

        // 3. 某些 Ollama 模型可能在 kwargs.content 或 additional_kwargs.content 中返回内容
        if (!chunkContent) {
          const kwargs = (chunk as any).kwargs;
          const additionalKwargs = (chunk as any).additional_kwargs;

          if (kwargs?.content && typeof kwargs.content === "string") {
            chunkContent = kwargs.content;
          } else if (additionalKwargs?.content && typeof additionalKwargs.content === "string") {
            chunkContent = additionalKwargs.content;
          }
        }

        // 4. 检查 response_metadata 中的内容（某些模型的备选位置）
        if (!chunkContent) {
          const responseMetadata = (chunk as any).response_metadata;
          if (responseMetadata?.message?.content && typeof responseMetadata.message.content === "string") {
            chunkContent = responseMetadata.message.content;
          }
        }

        if (chunkContent) {
          fullContent += chunkContent;
          // Emit streaming event for UI
          emitStreaming(fullContent, chunkContent);
        }

        // 记录每个 chunk 的详细信息（仅前5个，简化输出）
        if (chunkCount <= 5) {
          const additionalKwargs = (chunk as any).additional_kwargs || {};
          log.debug("Stream chunk", {
            i: chunkCount,
            content: chunkContent.length > 0 ? chunkContent.slice(0, 100) : "(empty)",
            // 只在有 reasoning_content 时显示（DeepSeek thinking）
            ...(additionalKwargs.reasoning_content && {
              thinking: additionalKwargs.reasoning_content.slice(0, 50),
            }),
            // 只在有 tool_call_chunks 时显示
            ...((chunk as any).tool_call_chunks?.length > 0 && {
              toolCallChunks: (chunk as any).tool_call_chunks.length,
            }),
          });
        }
      }

      log.debug("Model stream ended", {
        contentLength: fullContent.length,
        hasContent: fullContent.length > 0,
        hasAggregatedMessage: !!aggregatedMessage,
      });

      const durationMs = Date.now() - startTime;
      log.llmEnd(resolvedModelName, durationMs, chunkCount);

      // 记录响应详情
      if (aggregatedMessage) {
        const toolCalls = aggregatedMessage.tool_calls || [];
        const toolCallChunks = (aggregatedMessage as any).tool_call_chunks || [];
        const invalidToolCalls = aggregatedMessage.invalid_tool_calls || [];

        // 记录无效的工具调用（解析失败的工具调用）
        if (invalidToolCalls.length > 0) {
          log.warn("Invalid tool calls detected", {
            model: resolvedModelName,
            count: invalidToolCalls.length,
            invalidToolCalls: invalidToolCalls.map((tc: any) => ({
              name: tc.name,
              args: tc.args,
              error: tc.error,
            })),
          });
        }

        // 如果没有流式内容但 aggregatedMessage 有 content，使用它
        if (!fullContent && aggregatedMessage.content) {
          if (typeof aggregatedMessage.content === "string") {
            fullContent = aggregatedMessage.content;
          } else if (Array.isArray(aggregatedMessage.content)) {
            for (const part of aggregatedMessage.content) {
              if (typeof part === "string") {
                fullContent += part;
              } else if (part && typeof part === "object" && "text" in part) {
                fullContent += (part as any).text;
              }
            }
          }
          if (fullContent) {
            log.debug("Content recovered from aggregatedMessage", { contentLength: fullContent.length });
          }
        }

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
          invalidToolCallsCount: invalidToolCalls.length,
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

  log.debug("Simple chat model started", { model: resolvedModelName });

  const chatModel = getChatModel(modelName);

  try {
    const response = await chatModel.stream(trimmedMessages);
    let fullContent = "";
    let chunkCount = 0;

    for await (const chunk of response) {
      if (typeof chunk.content === "string" && chunk.content) {
        fullContent += chunk.content;
        emitStreaming(fullContent, chunk.content);
        chunkCount++;
      }
    }

    log.debug("Simple chat model ended", { contentLength: fullContent.length });

    const durationMs = Date.now() - startTime;
    log.info("Simple chat completed", {
      model: resolvedModelName,
      durationMs,
      chunkCount,
      contentLength: fullContent.length,
    });

    return fullContent;
  } catch (error: any) {
    log.debug("Simple chat model error");
    log.error("Simple chat failed", {
      model: resolvedModelName,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}
