import { Ollama } from "ollama";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AIMessage, HumanMessage, ToolMessage, BaseMessage } from "@langchain/core/messages";
import { StructuredToolInterface } from "@langchain/core/tools";
import { OLLAMA_HOST } from "../config";
import { log } from "../logger";
import { ui } from "../ui";

// 创建 Ollama 客户端
const ollama = new Ollama({ host: OLLAMA_HOST });

// Ollama 工具定义格式
interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

// 将 LangChain 工具转换为 Ollama 格式
export function convertToolsToOllamaFormat(tools: StructuredToolInterface[]): OllamaTool[] {
  log.debug("Converting tools to Ollama format", { toolCount: tools.length });

  return tools.map((tool) => {
    // 工具的 schema 可能是 Zod 或 JSON schema，需要兼容处理
    let parameters: Record<string, any>;

    try {
      // 尝试作为 Zod schema 转换
      const jsonSchema = zodToJsonSchema(tool.schema as any);
      const { $schema, ...rest } = jsonSchema as any;
      parameters = rest;
    } catch {
      // 如果不是 Zod schema，直接使用
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

// 将 LangChain 消息转换为 Ollama 格式
function convertMessagesToOllamaFormat(messages: BaseMessage[]): any[] {
  log.debug("Converting messages to Ollama format", { messageCount: messages.length });

  const converted = messages.map((msg, index) => {
    if (msg instanceof HumanMessage) {
      log.debug(`Message ${index}: HumanMessage`, {
        contentLength: typeof msg.content === "string" ? msg.content.length : 0,
      });
      return {
        role: "user",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      };
    } else if (msg instanceof AIMessage) {
      const result: any = {
        role: "assistant",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      };
      // 如果有 tool_calls，添加到消息中
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        log.debug(`Message ${index}: AIMessage with tool_calls`, {
          toolCount: msg.tool_calls.length,
          tools: msg.tool_calls.map(tc => tc.name),
        });
        result.tool_calls = msg.tool_calls.map((tc) => ({
          function: {
            name: tc.name,
            arguments: tc.args,
          },
        }));
      } else {
        log.debug(`Message ${index}: AIMessage`, {
          contentLength: typeof msg.content === "string" ? msg.content.length : 0,
        });
      }
      return result;
    } else if (msg instanceof ToolMessage) {
      log.debug(`Message ${index}: ToolMessage`, { name: msg.name });
      return {
        role: "tool",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      };
    }
    log.debug(`Message ${index}: Unknown type, treating as assistant`);
    return {
      role: "assistant",
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    };
  });

  log.debug("Messages converted", {
    total: converted.length,
    roles: converted.map(m => m.role),
  });
  return converted;
}

// 调用 Ollama 并支持工具调用（流式）
export async function callOllamaWithTools(
  messages: BaseMessage[],
  tools: StructuredToolInterface[],
  modelName: string,
  stream: boolean = true
): Promise<AIMessage> {
  const ollamaTools = convertToolsToOllamaFormat(tools);
  const ollamaMessages = convertMessagesToOllamaFormat(messages);
  const startTime = Date.now();

  log.llmStart(modelName, messages.length, tools.length > 0);
  log.info("Ollama API call initiated", {
    model: modelName,
    host: OLLAMA_HOST,
    messageCount: messages.length,
    toolCount: tools.length,
    streamMode: stream,
  });

  if (stream) {
    // 流式调用
    ui.modelStart(modelName);
    log.debug("Starting streaming response");

    try {
      const response = await ollama.chat({
        model: modelName,
        messages: ollamaMessages,
        tools: ollamaTools,
        stream: true,
      });

      let fullContent = "";
      let toolCalls: any[] = [];
      let tokenCount = 0;
      let chunkCount = 0;

      for await (const part of response) {
        chunkCount++;
        if (part.message.content) {
          ui.modelStream(part.message.content);
          fullContent += part.message.content;
          tokenCount++;
        }
        // 工具调用在最后一个 chunk 中
        if (part.message.tool_calls && part.message.tool_calls.length > 0) {
          toolCalls = part.message.tool_calls;
          log.debug("Tool calls received in stream", {
            toolCount: toolCalls.length,
            tools: toolCalls.map(tc => tc.function.name),
          });
        }
      }

      if (fullContent) {
        ui.modelEnd();
      }

      const durationMs = Date.now() - startTime;
      log.llmEnd(modelName, durationMs, tokenCount);
      log.info("Streaming response completed", {
        model: modelName,
        durationMs,
        chunkCount,
        contentLength: fullContent.length,
        hasToolCalls: toolCalls.length > 0,
        toolCount: toolCalls.length,
      });

      // 记录是否有工具调用（UI 回显由 LangGraph 流式回调处理）
      if (toolCalls.length > 0) {
        log.agentResponse(true, toolCalls.length);
        log.info("Tool calls to execute", {
          tools: toolCalls.map(tc => ({
            name: tc.function.name,
            argsPreview: JSON.stringify(tc.function.arguments).slice(0, 100),
          })),
        });
      } else {
        log.agentResponse(false, 0);
      }

      return new AIMessage({
        content: fullContent,
        tool_calls: toolCalls.map((tc, index) => ({
          name: tc.function.name,
          args: tc.function.arguments,
          id: `tool_${index}_${Date.now()}`,
          type: "tool_call" as const,
        })),
      });
    } catch (error: any) {
      log.llmError(modelName, error.message);
      log.error("Ollama streaming call failed", {
        model: modelName,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  } else {
    // 非流式调用
    log.debug("Starting non-streaming response");

    try {
      const response = await ollama.chat({
        model: modelName,
        messages: ollamaMessages,
        tools: ollamaTools,
        stream: false,
      });

      const durationMs = Date.now() - startTime;
      const toolCalls = response.message.tool_calls || [];

      log.llmEnd(modelName, durationMs, 0);
      log.info("Non-streaming response completed", {
        model: modelName,
        durationMs,
        contentLength: response.message.content.length,
        hasToolCalls: toolCalls.length > 0,
        toolCount: toolCalls.length,
      });
      log.agentResponse(toolCalls.length > 0, toolCalls.length);

      return new AIMessage({
        content: response.message.content,
        tool_calls: toolCalls.map((tc, index) => ({
          name: tc.function.name,
          args: tc.function.arguments,
          id: `tool_${index}_${Date.now()}`,
          type: "tool_call" as const,
        })),
      });
    } catch (error: any) {
      log.llmError(modelName, error.message);
      log.error("Ollama non-streaming call failed", {
        model: modelName,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
}

// 简单聊天（无工具，流式）
export async function chatWithOllama(
  messages: BaseMessage[],
  modelName: string
): Promise<string> {
  const startTime = Date.now();
  const ollamaMessages = convertMessagesToOllamaFormat(messages);

  log.info("Simple chat started (no tools)", {
    model: modelName,
    messageCount: messages.length,
  });

  ui.modelStart(modelName);

  try {
    const response = await ollama.chat({
      model: modelName,
      messages: ollamaMessages,
      stream: true,
    });

    let fullContent = "";
    let chunkCount = 0;

    for await (const part of response) {
      if (part.message.content) {
        ui.modelStream(part.message.content);
        fullContent += part.message.content;
        chunkCount++;
      }
    }
    ui.modelEnd();

    const durationMs = Date.now() - startTime;
    log.info("Simple chat completed", {
      model: modelName,
      durationMs,
      chunkCount,
      contentLength: fullContent.length,
    });

    return fullContent;
  } catch (error: any) {
    log.error("Simple chat failed", {
      model: modelName,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}
