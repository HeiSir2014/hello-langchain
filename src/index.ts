#!/usr/bin/env node
import * as readline from "readline";
import { HumanMessage } from "@langchain/core/messages";
import {
  DEFAULT_MODEL,
  getModelConfig,
  ALL_MODELS,
  USE_PROVIDER,
} from "./config.js";
import {
  multiTurnChat,
  clearHistory,
  getHistory,
  setAgentModel,
  getAgentModel,
  getThreadId,
  compactHistory,
} from "./agent/index.js";
import { toolDescriptions } from "./tools/index.js";
import { log, resetSessionId, LOG_DIR } from "./logger.js";
import { ui, colors } from "./ui.js";

// 切换模型
function switchModel(modelName: string): boolean {
  const config = getModelConfig(modelName);
  if (!config) {
    ui.error(`Model "${modelName}" not found`);
    return false;
  }

  setAgentModel(modelName);
  ui.modelSwitched(config.model, config.provider || "");
  return true;
}

// 显示帮助
function showHelp(): void {
  ui.help();
}

// 显示工具列表
function showTools(): void {
  ui.toolList(toolDescriptions);
}

// 显示模型列表
function showModels(): void {
  const currentModel = getAgentModel();
  const models = ALL_MODELS.map((m) => ({
    name: m.name,
    model: m.model,
    type: m.type,
    provider: m.provider || "",
    current: m.name === currentModel,
  }));
  ui.modelList(models);
}

// 显示对话历史
async function showHistory(): Promise<void> {
  const history = await getHistory();
  if (history.length === 0) {
    ui.info("No conversation history");
    return;
  }

  ui.heading(`History (${history.length} messages)`);
  history.forEach((msg, i) => {
    const role = msg instanceof HumanMessage ? "You" : "Assistant";
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    const preview = content.length > 80 ? content.slice(0, 80) + "..." : content;
    ui.listItem(`${colors.dim}${i + 1}.${colors.reset} ${colors.bold}${role}:${colors.reset} ${preview}`);
  });
  ui.newline();
}

// 交互式模式
async function interactiveMode(): Promise<void> {
  const config = getModelConfig(getAgentModel());

  ui.welcome();
  ui.startup({
    model: config?.model || getAgentModel(),
    provider: USE_PROVIDER,
    cwd: process.cwd(),
    supportsTools: config?.supportsTools ?? false,
  });

  log.sessionStart(getAgentModel());

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (): void => {
    rl.question(ui.prompt(), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        askQuestion();
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
            showModels();
            break;

          case "model":
          case "m":
            if (args[0]) {
              switchModel(args[0]);
            } else {
              ui.info(`Current model: ${getAgentModel()}`);
            }
            break;

          case "tools":
            showTools();
            break;

          case "clear":
          case "c":
            clearHistory();
            resetSessionId();
            ui.cleared();
            break;

          case "history":
            await showHistory();
            break;

          case "thread":
            ui.info(`Thread: ${getThreadId()}`);
            break;

          case "compact":
            try {
              const { before, after } = await compactHistory();
              if (before === after) {
                ui.info("No messages to compact");
              } else {
                ui.success(`Compacted: ${before} → ${after} messages`);
              }
            } catch (err: any) {
              ui.error(`Compact failed: ${err.message}`);
            }
            break;

          default:
            ui.warn(`Unknown command: /${cmd}`);
        }

        askQuestion();
        return;
      }

      // 处理对话
      ui.userMessage(trimmed);

      try {
        await multiTurnChat(trimmed);
      } catch (error: any) {
        ui.error(error.message || String(error));
        log.error("Chat error", { error: error.message });
      }

      askQuestion();
    });
  };

  askQuestion();
}

// 主函数
async function main() {
  const args = process.argv.slice(2);

  // 初始化默认模型
  setAgentModel(DEFAULT_MODEL);

  // 处理命令行参数
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: yterm [options]

Options:
  -m, --model <name>   Set model
  -l, --list           List models
  -h, --help           Show help

Examples:
  yterm                Start interactive mode
  yterm -l             List available models
  yterm -m gpt-4o      Use GPT-4o model
`);
    return;
  }

  if (args.includes("--list") || args.includes("-l")) {
    showModels();
    return;
  }

  // 指定模型
  const modelIndex = args.findIndex((a) => a === "--model" || a === "-m");
  if (modelIndex !== -1 && args[modelIndex + 1]) {
    switchModel(args[modelIndex + 1]);
  }

  // 进入交互式模式
  await interactiveMode();
}

main();
