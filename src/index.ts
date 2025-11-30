import * as readline from "readline";
import { HumanMessage } from "@langchain/core/messages";
import {
  DEFAULT_MODEL,
  getModelConfig,
  listModels,
} from "./config";
import {
  chat,
  multiTurnChat,
  clearHistory,
  getHistory,
  setAgentModel,
  getAgentModel,
  setToolConfirmation,
  getToolConfirmation,
  getThreadId,
  newThread,
  resume,
  getState,
} from "./agent";
import { toolDescriptions } from "./tools";
import { log, resetSessionId, LOG_DIR } from "./logger";
import { ui } from "./ui";

// 等待工具确认的状态
let pendingConfirmation = false;

// 切换模型
function switchModel(modelName: string): boolean {
  const config = getModelConfig(modelName);
  if (!config) {
    ui.error(`模型 "${modelName}" 不存在，可用模型：`);
    listModels();
    return false;
  }

  setAgentModel(modelName);
  ui.modelSwitch(config.model, config.type, config.supportsTools ?? false);
  return true;
}

// 显示帮助信息
function showHelp(): void {
  ui.system(`
命令:
  /help, /h           显示帮助信息
  /list, /l           列出所有可用模型
  /model <名称>        切换模型 (如: /model qwen3:4b)
  /tools              显示可用工具列表
  /clear, /c          清除对话历史（创建新线程）
  /history            显示对话历史
  /thread             显示当前线程 ID
  /confirm [on|off]   开启/关闭敏感工具确认
  /state              显示当前 Graph 状态
  /exit, /quit        退出程序

示例:
  /model qwen3:4b
  列出当前目录的文件
  读取 package.json 文件内容
  搜索包含 ollama 的代码
`);
}

// 显示工具列表
function showTools(): void {
  ui.heading("可用工具");
  toolDescriptions.forEach((t) => {
    ui.listItem(`🔧 ${t.name.padEnd(10)} - ${t.description}`);
  });
  ui.newline();
}

// 显示对话历史
async function showHistory(): Promise<void> {
  const history = await getHistory();
  if (history.length === 0) {
    ui.info("暂无对话历史");
    return;
  }
  ui.heading(`对话历史 (线程: ${getThreadId()})`);
  history.forEach((msg, i) => {
    const role = msg instanceof HumanMessage ? "👤 用户" : "🤖 助手";
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    ui.listItem(`${i + 1}. ${role}: ${content.slice(0, 100)}${content.length > 100 ? "..." : ""}`);
  });
  ui.newline();
}

// 显示当前状态
async function showState(): Promise<void> {
  try {
    const state = await getState();
    ui.heading("Graph 状态");
    ui.listItem(`线程 ID: ${getThreadId()}`);
    ui.listItem(`消息数: ${state.values?.messages?.length || 0}`);
    ui.listItem(`下一节点: ${state.next?.join(", ") || "无"}`);
    if (state.metadata) {
      ui.listItem(`步骤: ${(state.metadata as any).step || 0}`);
    }
    ui.newline();
  } catch (error: any) {
    ui.error(`获取状态失败: ${error.message}`);
  }
}

// 交互式模式
async function interactiveMode(): Promise<void> {
  const config = getModelConfig(getAgentModel());

  ui.startup({
    model: config?.model || getAgentModel(),
    description: config?.description,
    supportsTools: config?.supportsTools ?? false,
    logDir: LOG_DIR,
  });

  ui.info(`线程 ID: ${getThreadId()}`);
  ui.info(`工具确认: ${getToolConfirmation() ? "开启" : "关闭"}`);

  log.sessionStart(getAgentModel());

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    const promptText = pendingConfirmation ? "确认 (y/n): " : "👤 你: ";
    rl.question(promptText, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // 处理工具确认
      if (pendingConfirmation) {
        pendingConfirmation = false;
        try {
          await resume(trimmed.toLowerCase());
        } catch (error: any) {
          ui.error(`恢复执行失败: ${error.message || error}`);
          log.error("Resume error", { error: error.message });
        }
        prompt();
        return;
      }

      // 处理命令
      if (trimmed.startsWith("/")) {
        const [cmd, ...args] = trimmed.slice(1).split(" ");
        log.userCommand(cmd, args);

        switch (cmd.toLowerCase()) {
          case "exit":
          case "quit":
          case "q":
            const historyLength = (await getHistory()).length;
            log.sessionEnd(historyLength);
            ui.goodbye();
            rl.close();
            return;

          case "help":
          case "h":
            showHelp();
            break;

          case "list":
          case "l":
            listModels();
            break;

          case "model":
          case "m":
            if (args[0]) {
              switchModel(args[0]);
            } else {
              ui.info(`当前模型: ${getAgentModel()}`);
              ui.info("请指定模型名称，例如: /model qwen3:4b");
            }
            break;

          case "tools":
            showTools();
            break;

          case "clear":
          case "c":
            clearHistory();
            resetSessionId();
            break;

          case "history":
            await showHistory();
            break;

          case "thread":
            ui.info(`当前线程: ${getThreadId()}`);
            break;

          case "confirm":
            if (args[0] === "on") {
              setToolConfirmation(true);
              ui.success("敏感工具确认已开启（Bash, Write, Edit 需确认）");
            } else if (args[0] === "off") {
              setToolConfirmation(false);
              ui.success("敏感工具确认已关闭");
            } else {
              ui.info(`工具确认: ${getToolConfirmation() ? "开启" : "关闭"}`);
              ui.info("使用 /confirm on 或 /confirm off 切换");
            }
            break;

          case "state":
            await showState();
            break;

          default:
            ui.warn(`未知命令: /${cmd}，输入 /help 查看帮助`);
        }

        prompt();
        return;
      }

      // 处理对话
      try {
        await multiTurnChat(trimmed);
      } catch (error: any) {
        // 检查是否是 interrupt
        if (error.message?.includes("interrupt") || error.__interrupt__) {
          pendingConfirmation = true;
          ui.info("等待确认...");
        } else {
          ui.error(`调用失败: ${error.message || error}`);
          log.error("Chat error", { error: error.message });
        }
      }

      prompt();
    });
  };

  prompt();
}

// 主函数
async function main() {
  const args = process.argv.slice(2);

  // 初始化默认模型
  setAgentModel(DEFAULT_MODEL);

  // 处理命令行参数
  if (args.includes("--list") || args.includes("-l")) {
    listModels();
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    ui.system(`
用法: npm start [选项] [消息]

选项:
  -m, --model <名称>   指定模型 (默认: ${DEFAULT_MODEL})
  -l, --list           列出所有模型
  -i, --interactive    进入交互式模式
  --confirm            启用敏感工具确认
  -h, --help           显示帮助

示例:
  npm start                              # 交互式模式 (默认)
  npm start -- -m qwen3:4b "列出文件"     # 单次对话
  npm start -- --list                    # 列出模型
  npm start -- --confirm -i              # 带工具确认的交互模式
`);
    return;
  }

  // 指定模型
  const modelIndex = args.findIndex((a) => a === "--model" || a === "-m");
  if (modelIndex !== -1 && args[modelIndex + 1]) {
    switchModel(args[modelIndex + 1]);
  }

  // 启用工具确认
  if (args.includes("--confirm")) {
    setToolConfirmation(true);
  }

  // 交互式模式
  if (args.includes("--interactive") || args.includes("-i")) {
    await interactiveMode();
    return;
  }

  // 过滤掉选项参数，获取实际消息
  const filteredArgs = args.filter((_, i) => {
    if (i === modelIndex || i === modelIndex + 1) return false;
    return true;
  }).filter((a) => !a.startsWith("-"));

  // 如果没有消息参数，进入交互式模式
  if (filteredArgs.length === 0) {
    await interactiveMode();
    return;
  }

  const message = filteredArgs.join(" ");
  ui.userInput(message);

  try {
    await chat(message);
  } catch (error: any) {
    ui.error(`调用失败: ${error.message || error}`);
    log.error("Chat error", { error: error.message });
  }
}

main();
