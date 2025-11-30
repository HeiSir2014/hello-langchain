/**
 * UI 输出模块 - 处理用户可见的控制台输出
 * 所有 UI 输出同时记录到日志文件
 */

import { log } from "./logger";

// ANSI 颜色码
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

// 图标
const icons = {
  robot: "🤖",
  user: "👤",
  tool: "🔧",
  folder: "📁",
  file: "📄",
  search: "🔍",
  edit: "✏️",
  write: "📝",
  read: "📖",
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "💡",
  refresh: "🔄",
  rocket: "🚀",
  wave: "👋",
};

// 去除 ANSI 颜色码的工具函数
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// UI 输出类
class UI {
  // 当前流式输出的内容缓冲
  private streamBuffer: string = "";

  // 系统消息
  system(message: string): void {
    console.log(`${colors.cyan}${message}${colors.reset}`);
    log.info(`[UI:system] ${stripAnsi(message)}`);
  }

  // 成功消息
  success(message: string): void {
    console.log(`${colors.green}${icons.success} ${message}${colors.reset}`);
    log.info(`[UI:success] ${message}`);
  }

  // 错误消息
  error(message: string): void {
    console.error(`${colors.red}${icons.error} ${message}${colors.reset}`);
    log.error(`[UI:error] ${message}`);
  }

  // 警告消息
  warn(message: string): void {
    console.log(`${colors.yellow}${icons.warning} ${message}${colors.reset}`);
    log.warn(`[UI:warn] ${message}`);
  }

  // 信息提示
  info(message: string): void {
    console.log(`${colors.gray}${icons.info} ${message}${colors.reset}`);
    log.info(`[UI:info] ${message}`);
  }

  // 模型响应开始（流式输出前缀）
  modelStart(modelName: string): void {
    process.stdout.write(`\n${icons.robot} ${colors.dim}[${modelName}]${colors.reset} `);
    this.streamBuffer = "";
    log.info(`[UI:model] Start streaming response`, { model: modelName });
  }

  // 模型流式输出
  modelStream(content: string): void {
    process.stdout.write(content);
    this.streamBuffer += content;
  }

  // 模型响应结束
  modelEnd(): void {
    console.log("\n");
    // 记录完整的模型输出
    if (this.streamBuffer) {
      log.info(`[UI:model] Response content`, {
        length: this.streamBuffer.length,
        content: this.streamBuffer.length > 500
          ? this.streamBuffer.slice(0, 500) + `...(${this.streamBuffer.length} chars)`
          : this.streamBuffer
      });
    }
    this.streamBuffer = "";
  }

  // 工具调用请求
  toolRequest(toolCount: number, toolCalls: Array<{ name: string; args: any }>): void {
    console.log(`\n${icons.refresh} 模型请求调用 ${toolCount} 个工具:`);
    toolCalls.forEach((tc, i) => {
      const argsStr = JSON.stringify(tc.args);
      console.log(`   ${i + 1}. ${tc.name}(${argsStr.length > 100 ? argsStr.slice(0, 100) + "..." : argsStr})`);
    });
    log.info(`[UI:toolRequest] Model requesting ${toolCount} tool(s)`, {
      tools: toolCalls.map(tc => ({
        name: tc.name,
        args: tc.args,
      })),
    });
  }

  // 工具执行开始
  toolStart(toolName: string, detail?: string): void {
    const detailStr = detail ? `: ${detail}` : "";
    console.log(`\n${this.getToolIcon(toolName)} [${toolName}]${detailStr}`);
    log.info(`[UI:toolStart] ${toolName}`, { detail: detail || "" });
  }

  // 工具执行成功
  toolSuccess(toolName: string, summary: string): void {
    console.log(`${icons.success} [${toolName}] ${summary}`);
    log.info(`[UI:toolSuccess] ${toolName}: ${summary}`);
  }

  // 工具执行失败
  toolError(toolName: string, error: string): void {
    console.log(`${icons.error} [${toolName}] ${error}`);
    log.error(`[UI:toolError] ${toolName}: ${error}`);
  }

  // 工具执行结果（从 LangGraph 流式回调中调用）
  toolResult(toolName: string, result: string): void {
    console.log(`${colors.dim}   ↳ [${toolName}] ${result}${colors.reset}`);
    log.info(`[UI:toolResult] ${toolName}`, {
      resultPreview: result.length > 200 ? result.slice(0, 200) + "..." : result
    });
  }

  // 获取工具对应的图标
  private getToolIcon(toolName: string): string {
    const iconMap: Record<string, string> = {
      Bash: icons.tool,
      Read: icons.read,
      Write: icons.write,
      Edit: icons.edit,
      Glob: icons.folder,
      Grep: icons.search,
      LS: icons.folder,
    };
    return iconMap[toolName] || icons.tool;
  }

  // 启动信息
  startup(config: { model: string; description?: string; supportsTools: boolean; logDir: string }): void {
    console.log(`\n${icons.rocket} LangGraph + Ollama Agent`);
    console.log(`📍 当前模型: ${config.model} (${config.description || ""})`);
    console.log(`🔧 工具调用: ${config.supportsTools ? "已启用" : "不支持"}`);
    console.log(`📝 日志目录: ${config.logDir}`);
    console.log(`${icons.info} 输入 /help 查看命令帮助，输入 /exit 退出\n`);
    log.info(`[UI:startup] Agent started`, {
      model: config.model,
      description: config.description,
      supportsTools: config.supportsTools,
      logDir: config.logDir,
    });
  }

  // 模型切换
  modelSwitch(model: string, type: string, supportsTools: boolean): void {
    const toolSupport = supportsTools ? "支持工具调用 🔧" : "不支持工具调用 ⚠️";
    console.log(`已切换到模型: ${model}`);
    console.log(`  类型: ${type}`);
    console.log(`  ${toolSupport}`);
    console.log("");
    log.info(`[UI:modelSwitch] Switched to model`, { model, type, supportsTools });
  }

  // 用户输入回显
  userInput(message: string): void {
    console.log(`\n${icons.user} 你: ${message}`);
    log.info(`[UI:userInput] User message`, {
      message: message.length > 200 ? message.slice(0, 200) + "..." : message
    });
  }

  // 退出消息
  goodbye(): void {
    console.log(`再见！${icons.wave}`);
    log.info(`[UI:goodbye] Session ended by user`);
  }

  // 空行
  newline(): void {
    console.log("");
  }

  // 分隔线
  divider(char: string = "─", length: number = 40): void {
    console.log(char.repeat(length));
  }

  // 列表项
  listItem(content: string, indent: number = 0): void {
    const prefix = "  ".repeat(indent);
    console.log(`${prefix}${content}`);
    log.debug(`[UI:listItem] ${content}`);
  }

  // 标题
  heading(title: string): void {
    console.log(`\n=== ${title} ===`);
    log.info(`[UI:heading] ${title}`);
  }

  // 调试信息（仅日志，不输出到控制台）
  logOnly(message: string, meta?: Record<string, any>): void {
    log.debug(`[UI:logOnly] ${message}`, meta);
  }
}

// 导出单例
export const ui = new UI();
export { icons, colors };
