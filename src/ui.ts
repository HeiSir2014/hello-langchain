/**
 * UI 输出模块 - Claude Code 风格的控制台交互
 */

import { log } from "./logger.js";

// ANSI 颜色码
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",

  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",

  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
};

// 去除 ANSI 颜色码
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// Spinner 动画帧
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class UI {
  private streamBuffer: string = "";
  private spinnerInterval: NodeJS.Timeout | null = null;
  private spinnerFrame: number = 0;
  private currentSpinnerText: string = "";
  private isStreaming: boolean = false;

  // ============ 基础输出 ============

  // 打印带颜色的文本
  private print(text: string, color?: string): void {
    if (color) {
      console.log(`${color}${text}${colors.reset}`);
    } else {
      console.log(text);
    }
  }

  // 写入（不换行）
  private write(text: string): void {
    process.stdout.write(text);
  }

  // 清除当前行
  private clearLine(): void {
    process.stdout.write("\r\x1b[K");
  }

  // ============ Spinner ============

  startSpinner(text: string): void {
    this.stopSpinner();
    this.currentSpinnerText = text;
    this.spinnerFrame = 0;

    this.spinnerInterval = setInterval(() => {
      this.clearLine();
      const frame = spinnerFrames[this.spinnerFrame % spinnerFrames.length];
      this.write(`${colors.cyan}${frame}${colors.reset} ${this.currentSpinnerText}`);
      this.spinnerFrame++;
    }, 80);
  }

  updateSpinner(text: string): void {
    this.currentSpinnerText = text;
  }

  stopSpinner(finalText?: string): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
      this.clearLine();
      if (finalText) {
        console.log(finalText);
      }
    }
  }

  // ============ 启动信息 ============

  welcome(): void {
    console.log();
    console.log(`${colors.bold}╭─────────────────────────────────────╮${colors.reset}`);
    console.log(`${colors.bold}│${colors.reset}  ${colors.cyan}${colors.bold}yterm${colors.reset} - AI Terminal Assistant    ${colors.bold}│${colors.reset}`);
    console.log(`${colors.bold}╰─────────────────────────────────────╯${colors.reset}`);
    console.log();
  }

  startup(config: {
    model: string;
    provider: string;
    cwd: string;
    supportsTools: boolean;
  }): void {
    console.log(`${colors.dim}Model:${colors.reset} ${config.model}`);
    console.log(`${colors.dim}Provider:${colors.reset} ${config.provider}`);
    console.log(`${colors.dim}CWD:${colors.reset} ${config.cwd}`);
    console.log(`${colors.dim}Tools:${colors.reset} ${config.supportsTools ? "enabled" : "disabled"}`);
    console.log();
    console.log(`${colors.dim}Type ${colors.reset}/help${colors.dim} for commands, ${colors.reset}/exit${colors.dim} to quit${colors.reset}`);
    console.log();

    log.info("[UI:startup]", config);
  }

  // ============ 提示符 ============

  prompt(): string {
    return `${colors.bold}${colors.green}>${colors.reset} `;
  }

  // ============ 消息输出 ============

  // 用户输入
  userMessage(message: string): void {
    // 不需要回显，readline 已经显示了
    log.info("[UI:user]", { message: message.slice(0, 200) });
  }

  // 模型响应开始
  modelStart(_modelName?: string): void {
    this.streamBuffer = "";
    this.isStreaming = true;
    console.log();
  }

  // 模型流式输出
  modelStream(content: string): void {
    this.write(content);
    this.streamBuffer += content;
  }

  // 模型响应结束
  modelEnd(): void {
    if (this.isStreaming) {
      console.log();
      console.log();
      this.isStreaming = false;
    }
    if (this.streamBuffer) {
      log.info("[UI:model]", {
        length: this.streamBuffer.length,
        preview: this.streamBuffer.slice(0, 500),
      });
    }
    this.streamBuffer = "";
  }

  // ============ 工具调用显示 ============

  // 工具调用请求
  toolRequest(toolName: string, args: Record<string, any>): void {
    // 格式化参数显示
    let argsDisplay = "";

    if (toolName === "Bash") {
      argsDisplay = args.command || "";
      if (args.description) {
        console.log(`${colors.dim}$ ${argsDisplay}${colors.reset}`);
      } else {
        console.log(`${colors.dim}$ ${argsDisplay.slice(0, 100)}${argsDisplay.length > 100 ? "..." : ""}${colors.reset}`);
      }
    } else if (toolName === "Read") {
      console.log(`${colors.dim}Reading ${args.file_path}${colors.reset}`);
    } else if (toolName === "Write") {
      console.log(`${colors.dim}Writing ${args.file_path}${colors.reset}`);
    } else if (toolName === "Edit") {
      console.log(`${colors.dim}Editing ${args.file_path}${colors.reset}`);
    } else if (toolName === "Glob") {
      console.log(`${colors.dim}Searching ${args.pattern}${colors.reset}`);
    } else if (toolName === "Grep") {
      console.log(`${colors.dim}Grep: ${args.pattern}${colors.reset}`);
    } else if (toolName === "TodoWrite") {
      const count = args.todos?.length || 0;
      console.log(`${colors.dim}Updating todo list (${count} items)${colors.reset}`);
    } else {
      argsDisplay = JSON.stringify(args);
      console.log(`${colors.dim}${toolName}: ${argsDisplay.slice(0, 80)}${argsDisplay.length > 80 ? "..." : ""}${colors.reset}`);
    }

    log.info("[UI:tool]", { tool: toolName, args });
  }

  // 工具执行结果
  toolResult(toolName: string, result: string, isError: boolean = false): void {
    // 简短显示结果
    const lines = result.split("\n");
    const displayLines = lines.slice(0, 5);

    if (isError) {
      console.log(`${colors.red}Error: ${displayLines[0]}${colors.reset}`);
    } else if (lines.length > 5) {
      // 对于长输出，只显示行数
      console.log(`${colors.dim}  (${lines.length} lines)${colors.reset}`);
    }

    log.info("[UI:toolResult]", {
      tool: toolName,
      lines: lines.length,
      preview: result.slice(0, 200),
    });
  }

  // 多工具调用摘要
  toolsSummary(tools: Array<{ name: string; args: any }>): void {
    if (tools.length === 1) {
      this.toolRequest(tools[0].name, tools[0].args);
    } else {
      console.log(`${colors.dim}Running ${tools.length} tools...${colors.reset}`);
      tools.forEach((t) => {
        console.log(`${colors.dim}  • ${t.name}${colors.reset}`);
      });
    }
  }

  // ============ 状态消息 ============

  info(message: string): void {
    console.log(`${colors.dim}${message}${colors.reset}`);
    log.info("[UI:info]", { message });
  }

  success(message: string): void {
    console.log(`${colors.green}✓${colors.reset} ${message}`);
    log.info("[UI:success]", { message });
  }

  error(message: string): void {
    console.log(`${colors.red}✗${colors.reset} ${message}`);
    log.error("[UI:error]", { message });
  }

  warn(message: string): void {
    console.log(`${colors.yellow}!${colors.reset} ${message}`);
    log.warn("[UI:warn]", { message });
  }

  // ============ 帮助信息 ============

  help(): void {
    console.log();
    console.log(`${colors.bold}Commands:${colors.reset}`);
    console.log(`  ${colors.cyan}/help${colors.reset}, ${colors.cyan}/h${colors.reset}         Show this help`);
    console.log(`  ${colors.cyan}/model${colors.reset} <name>   Switch model`);
    console.log(`  ${colors.cyan}/list${colors.reset}, ${colors.cyan}/l${colors.reset}        List available models`);
    console.log(`  ${colors.cyan}/tools${colors.reset}          Show available tools`);
    console.log(`  ${colors.cyan}/clear${colors.reset}, ${colors.cyan}/c${colors.reset}       Clear conversation`);
    console.log(`  ${colors.cyan}/history${colors.reset}        Show message history`);
    console.log(`  ${colors.cyan}/compact${colors.reset}        Compact conversation history`);
    console.log(`  ${colors.cyan}/exit${colors.reset}, ${colors.cyan}/q${colors.reset}        Exit`);
    console.log();
  }

  // 显示模型列表
  modelList(models: Array<{ name: string; model: string; type: string; provider: string; current: boolean }>): void {
    console.log();
    console.log(`${colors.bold}Available Models:${colors.reset}`);
    models.forEach((m) => {
      const marker = m.current ? `${colors.green}●${colors.reset}` : " ";
      const provider = `${colors.dim}[${m.provider}]${colors.reset}`;
      console.log(`  ${marker} ${m.name} ${provider}`);
    });
    console.log();
  }

  // 显示工具列表
  toolList(tools: Array<{ name: string; description: string }>): void {
    console.log();
    console.log(`${colors.bold}Available Tools:${colors.reset}`);
    tools.forEach((t) => {
      console.log(`  ${colors.cyan}${t.name.padEnd(12)}${colors.reset} ${colors.dim}${t.description}${colors.reset}`);
    });
    console.log();
  }

  // ============ 对话管理 ============

  cleared(): void {
    console.log(`${colors.dim}Conversation cleared${colors.reset}`);
    console.log();
  }

  modelSwitched(model: string, provider: string): void {
    console.log(`${colors.dim}Switched to ${model} [${provider}]${colors.reset}`);
    console.log();
  }

  // ============ 退出 ============

  goodbye(): void {
    console.log();
    console.log(`${colors.dim}Goodbye!${colors.reset}`);
    log.info("[UI:goodbye]");
  }

  // ============ 进度显示 ============

  thinking(): void {
    this.startSpinner("Thinking...");
  }

  // ============ 辅助方法 ============

  newline(): void {
    console.log();
  }

  listItem(content: string): void {
    console.log(`  ${content}`);
  }

  heading(title: string): void {
    console.log();
    console.log(`${colors.bold}${title}${colors.reset}`);
  }

  system(message: string): void {
    console.log(`${colors.dim}${message}${colors.reset}`);
  }

  logOnly(message: string, meta?: Record<string, any>): void {
    log.debug(message, meta);
  }
}

// 导出单例
export const ui = new UI();
export { colors };
