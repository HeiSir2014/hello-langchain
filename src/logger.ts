import winston from "winston";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

// 日志目录
const LOG_DIR = join(process.cwd(), "logs");

// 确保日志目录存在
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

// 日志级别颜色（用于控制台）
const levelColors: Record<string, string> = {
  error: "\x1b[31m",   // 红色
  warn: "\x1b[33m",    // 黄色
  info: "\x1b[36m",    // 青色
  debug: "\x1b[90m",   // 灰色
};
const resetColor = "\x1b[0m";

// 文本格式化器
const textFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length > 0
    ? " | " + Object.entries(meta).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")
    : "";
  return `[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message}${metaStr}`;
});

// 创建 logger 实例
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "debug",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    winston.format.errors({ stack: true }),
    textFormat
  ),
  transports: [
    // 所有日志写入单一文件
    new winston.transports.File({
      filename: join(LOG_DIR, "app.log"),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true, // 确保最新日志始终在 app.log 中
    }),
  ],
});

// 会话 ID 生成器
export function generateSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// 当前会话 ID
let currentSessionId = generateSessionId();

export function getSessionId(): string {
  return currentSessionId;
}

export function resetSessionId(): void {
  currentSessionId = generateSessionId();
  logger.info(`Session reset`, { sessionId: currentSessionId });
}

// 便捷日志方法
export const log = {
  // 基础日志
  debug: (message: string, meta?: Record<string, any>) =>
    logger.debug(message, { sessionId: currentSessionId, ...meta }),
  info: (message: string, meta?: Record<string, any>) =>
    logger.info(message, { sessionId: currentSessionId, ...meta }),
  warn: (message: string, meta?: Record<string, any>) =>
    logger.warn(message, { sessionId: currentSessionId, ...meta }),
  error: (message: string, meta?: Record<string, any>) =>
    logger.error(message, { sessionId: currentSessionId, ...meta }),

  // 会话
  sessionStart: (model: string) =>
    logger.info(`Session started`, { sessionId: currentSessionId, model }),
  sessionEnd: (messageCount: number) =>
    logger.info(`Session ended`, { sessionId: currentSessionId, messageCount }),

  // 用户
  userInput: (input: string) =>
    logger.info(`User input`, { sessionId: currentSessionId, input: input.slice(0, 200) }),
  userCommand: (command: string, args: string[]) =>
    logger.info(`User command: /${command}`, { sessionId: currentSessionId, args }),

  // Graph
  graphStart: (inputMessages: number) =>
    logger.info(`Graph execution started`, { sessionId: currentSessionId, inputMessages }),
  graphEnd: (outputMessages: number, durationMs: number) =>
    logger.info(`Graph execution completed`, { sessionId: currentSessionId, outputMessages, durationMs }),
  nodeStart: (nodeName: string, state: any) =>
    logger.debug(`Node [${nodeName}] started`, { sessionId: currentSessionId, messageCount: state?.messages?.length }),
  nodeEnd: (nodeName: string, state: any, durationMs: number) =>
    logger.debug(`Node [${nodeName}] completed`, { sessionId: currentSessionId, durationMs }),
  conditionalEdge: (from: string, condition: string, result: string) =>
    logger.debug(`Edge: ${from} -> ${result}`, { sessionId: currentSessionId, condition }),

  // Agent
  agentThinking: (model: string) =>
    logger.info(`Agent thinking`, { sessionId: currentSessionId, model }),
  agentResponse: (hasToolCalls: boolean, toolCount: number) =>
    logger.info(`Agent response`, { sessionId: currentSessionId, hasToolCalls, toolCount }),

  // LLM
  llmStart: (model: string, messageCount: number, hasTools: boolean) =>
    logger.info(`LLM call started`, { sessionId: currentSessionId, model, messageCount, hasTools }),
  llmEnd: (model: string, durationMs: number, tokenCount: number) =>
    logger.info(`LLM call completed`, { sessionId: currentSessionId, model, durationMs, tokenCount }),
  llmError: (model: string, error: string) =>
    logger.error(`LLM call failed`, { sessionId: currentSessionId, model, error }),

  // 工具
  toolStart: (toolName: string, args: Record<string, any>) =>
    logger.info(`Tool [${toolName}] started`, { sessionId: currentSessionId, args: sanitizeArgs(args) }),
  toolEnd: (toolName: string, durationMs: number, resultSize: number) =>
    logger.info(`Tool [${toolName}] completed`, { sessionId: currentSessionId, durationMs, resultSize }),
  toolError: (toolName: string, error: string) =>
    logger.error(`Tool [${toolName}] failed`, { sessionId: currentSessionId, error }),
};

// 辅助函数：清理敏感/大参数
function sanitizeArgs(args: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.length > 100) {
      sanitized[key] = `${value.slice(0, 100)}...(${value.length} chars)`;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// 导出日志目录路径
export { LOG_DIR };
