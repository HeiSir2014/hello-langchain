import { OpenRouter } from "@openrouter/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { StructuredToolInterface } from "@langchain/core/tools";
import { getModelConfig, ModelType } from "../config";
import { log } from "../logger";
import { ui } from "../ui";

interface OpenRouterTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const openRouter =
  OPENROUTER_API_KEY.trim().length > 0
    ? new OpenRouter({
        apiKey: OPENROUTER_API_KEY,
      })
    : null;

export function convertToolsToOpenRouterFormat(
  tools: StructuredToolInterface[],
): OpenRouterTool[] {
  log.debug("Converting tools to OpenRouter format", {
    toolCount: tools.length,
  });

  return tools.map((tool) => {
    let parameters: Record<string, unknown>;

    try {
      const jsonSchema = zodToJsonSchema(tool.schema as any);
      const { $schema, ...rest } = jsonSchema as any;
      parameters = rest;
    } catch {
      parameters = tool.schema as any;
    }

    log.debug("Tool converted", { name: tool.name });
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters,
      },
    };
  });
}

function convertMessagesToOpenRouterFormat(messages: BaseMessage[]): any[] {
  log.debug("Converting messages to OpenRouter format", {
    messageCount: messages.length,
  });

  const converted = messages.map((msg, index) => {
    if (msg instanceof HumanMessage) {
      log.debug(`Message ${index}: HumanMessage`, {
        contentLength:
          typeof msg.content === "string" ? msg.content.length : 0,
      });
      return {
        role: "user",
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
      };
    }

    if (msg instanceof AIMessage) {
      const result: any = {
        role: "assistant",
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
      };

      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length > 0) {
        log.debug(`Message ${index}: AIMessage with tool_calls`, {
          toolCount: toolCalls.length,
          tools: toolCalls.map((tc) => tc.name),
        });
        result.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments:
              typeof tc.args === "string"
                ? tc.args
                : JSON.stringify(tc.args),
          },
        }));
      } else {
        log.debug(`Message ${index}: AIMessage`, {
          contentLength:
            typeof msg.content === "string" ? msg.content.length : 0,
        });
      }

      return result;
    }

    if (msg instanceof ToolMessage) {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);

      // 尝试多种方式获取 tool_call_id
      let toolCallId =
        (msg as any).tool_call_id ||
        (msg as any).additional_kwargs?.tool_call_id ||
        msg.id ||
        undefined;

      // 如果还是没有，生成一个警告并使用默认值
      if (!toolCallId) {
        log.warn("ToolMessage missing tool_call_id, using fallback", {
          name: msg.name,
          messageId: msg.id,
        });
        toolCallId = `tool_call_${index}_${Date.now()}`;
      }

      log.debug(`Message ${index}: ToolMessage`, {
        name: msg.name,
        toolCallId,
      });

      return {
        role: "tool",
        content,
        tool_call_id: toolCallId,
      };
    }

    log.debug(`Message ${index}: Unknown type, treating as assistant`);
    return {
      role: "assistant",
      content:
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content),
    };
  });

  log.debug("Messages converted", {
    total: converted.length,
    roles: converted.map((m) => m.role),
  });
  return converted;
}

export async function callOpenRouterWithTools(
  messages: BaseMessage[],
  tools: StructuredToolInterface[],
  modelName: string,
  stream: boolean = true,
): Promise<AIMessage> {
  const startTime = Date.now();
  const openRouterTools = convertToolsToOpenRouterFormat(tools);
  const openRouterMessages = convertMessagesToOpenRouterFormat(messages);

  const modelConfig = getModelConfig(modelName);
  const resolvedModelName = modelConfig?.model || modelName;

  log.llmStart(resolvedModelName, messages.length, tools.length > 0);
  log.info("OpenRouter API call initiated", {
    model: resolvedModelName,
    messageCount: messages.length,
    toolCount: tools.length,
    streamMode: stream,
  });

  if (!openRouter) {
    const error = new Error(
      "OPENROUTER_API_KEY is not configured. Please set it in your environment.",
    );
    log.llmError(resolvedModelName, error.message);
    log.error("OpenRouter client not initialized", {
      error: error.message,
    });
    throw error;
  }

  ui.modelStart(resolvedModelName);

  try {
    // 只使用 SDK
    const result = await openRouter.chat.send({
      model: resolvedModelName,
      messages: openRouterMessages,
      tools: openRouterTools,
      stream: false,
    });

    const message: any = result.choices?.[0]?.message || {};
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");

    if (content) {
      if (stream) {
        ui.modelStream(content);
      }
      ui.modelEnd();
    }

    const rawToolCalls =
      (message.tool_calls as any[]) || (message.toolCalls as any[]) || [];

    const toolCalls = rawToolCalls.map((tc: any, index: number) => {
      // 处理缺少 arguments 的情况
      let args = tc.function?.arguments;
      if (args === undefined || args === null) {
        args = {}; // 提供默认空对象
      } else if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch (e) {
          log.warn("Failed to parse tool arguments", { args, error: (e as Error).message });
          args = {};
        }
      }

      return {
        name: tc.function?.name,
        args,
        id: tc.id || `tool_${index}_${Date.now()}`,
        type: "tool_call" as const,
      };
    });

    const durationMs = Date.now() - startTime;
    log.llmEnd(resolvedModelName, durationMs, 0);
    log.info("OpenRouter response completed", {
      model: resolvedModelName,
      durationMs,
      contentLength: content.length,
      hasToolCalls: toolCalls.length > 0,
      toolCount: toolCalls.length,
    });

    if (toolCalls.length > 0) {
      log.agentResponse(true, toolCalls.length);
      log.info("Tool calls to execute", {
        tools: toolCalls.map((tc) => ({
          name: tc.name,
          argsPreview: String(tc.args).slice(0, 100),
        })),
      });
    } else {
      log.agentResponse(false, 0);
    }

    return new AIMessage({
      content,
      tool_calls: toolCalls,
    });
  } catch (error: any) {
    ui.modelEnd();

    // Try to extract detailed error message from OpenRouter
    let detailedError = error.message;
    const errorBody = error.body || error.response?.data || error.error;
    const statusCode = error.statusCode || error.status;

    if (errorBody) {
      try {
        const parsedError = typeof errorBody === 'string' ? JSON.parse(errorBody) : errorBody;
        if (parsedError?.error?.metadata?.raw) {
          detailedError = parsedError.error.metadata.raw;
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

    log.llmError(resolvedModelName, detailedError);
    log.error("OpenRouter call failed", {
      model: resolvedModelName,
      error: error.message,
      detailedError,
      errorBody,
      statusCode,
      stack: error.stack,
    });

    // Create a more informative error
    const enhancedError: any = new Error(detailedError);
    enhancedError.statusCode = statusCode;
    enhancedError.originalError = error;
    throw enhancedError;
  }
}

export async function chatWithOpenRouter(
  messages: BaseMessage[],
  modelName: string,
): Promise<string> {
  const startTime = Date.now();
  const openRouterMessages = convertMessagesToOpenRouterFormat(messages);

  const modelConfig = getModelConfig(modelName);
  const resolvedModelName = modelConfig?.model || modelName;

  log.info("Simple OpenRouter chat started (no tools)", {
    model: resolvedModelName,
    messageCount: messages.length,
  });

  if (!openRouter) {
    const error = new Error(
      "OPENROUTER_API_KEY is not configured. Please set it in your environment.",
    );
    log.error("OpenRouter client not initialized", {
      error: error.message,
    });
    throw error;
  }

  ui.modelStart(resolvedModelName);

  try {
    const result = await openRouter.chat.send({
      model: resolvedModelName,
      messages: openRouterMessages,
      stream: false,
    });

    const message: any = result.choices?.[0]?.message || {};
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");

    if (content) {
      ui.modelStream(content);
      ui.modelEnd();
    }

    const durationMs = Date.now() - startTime;
    log.info("Simple OpenRouter chat completed", {
      model: resolvedModelName,
      durationMs,
      contentLength: content.length,
    });

    return content;
  } catch (error: any) {
    ui.modelEnd();

    // Try to extract detailed error message from OpenRouter
    let detailedError = error.message;
    const errorBody = error.body || error.response?.data || error.error;
    const statusCode = error.statusCode || error.status;

    if (errorBody) {
      try {
        const parsedError = typeof errorBody === 'string' ? JSON.parse(errorBody) : errorBody;
        if (parsedError?.error?.metadata?.raw) {
          detailedError = parsedError.error.metadata.raw;
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

    log.error("Simple OpenRouter chat failed", {
      model: resolvedModelName,
      error: error.message,
      detailedError,
      errorBody,
      statusCode,
      stack: error.stack,
    });

    // Create a more informative error
    const enhancedError: any = new Error(detailedError);
    enhancedError.statusCode = statusCode;
    enhancedError.originalError = error;
    throw enhancedError;
  }
}


