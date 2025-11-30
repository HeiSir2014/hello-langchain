import { config } from "dotenv";
import { resolve } from "path";
import { ui } from "./ui";

// 加载环境变量，优先 .env.local
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });

// 模型类型枚举
export enum ModelType {
  LOCAL = "local",
  CLOUD = "cloud",
}

export interface ModelConfig {
  name: string;
  model: string;
  type: ModelType;
  description?: string;
  supportsTools?: boolean; // 是否支持工具调用
  contextWindow?: number;  // 上下文窗口大小（tokens）
}

// Ollama 配置
export const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
export const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";

// 默认上下文窗口大小
export const DEFAULT_CONTEXT_WINDOW = 32768;

// 本地安装的 Ollama 模型
export const LOCAL_MODELS: ModelConfig[] = [
  { name: "qwen3:4b", model: "qwen3:4b", type: ModelType.LOCAL, description: "Qwen3 4B - 轻量级", supportsTools: true, contextWindow: 32768 },
  { name: "qwen3:8b", model: "qwen3:8b", type: ModelType.LOCAL, description: "Qwen3 8B", supportsTools: true, contextWindow: 32768 },
  { name: "qwen3:0.6b", model: "qwen3:0.6b", type: ModelType.LOCAL, description: "Qwen3 0.6B - 最小", supportsTools: false, contextWindow: 8192 },
  { name: "qwen3-coder", model: "qwen3-coder:latest", type: ModelType.LOCAL, description: "Qwen3 Coder 18GB", supportsTools: true, contextWindow: 32768 },
  { name: "gemma3:4b", model: "gemma3:4b", type: ModelType.LOCAL, description: "Gemma3 4B", supportsTools: false, contextWindow: 8192 },
];

// Ollama Cloud 模型（支持 Tool Calling）
export const CLOUD_MODELS: ModelConfig[] = [
  { name: "gpt-oss", model: "gpt-oss:120b-cloud", type: ModelType.CLOUD, description: "GPT-OSS 120B - 推理 & Agent", supportsTools: true, contextWindow: 128000 },
  { name: "qwen3-coder-480b", model: "qwen3-coder:480b-cloud", type: ModelType.CLOUD, description: "Qwen3 Coder 480B - 编码专用", supportsTools: true, contextWindow: 128000 },
  { name: "qwen3-vl", model: "qwen3-vl:235b-cloud", type: ModelType.CLOUD, description: "Qwen3 VL 235B - 视觉语言", supportsTools: true, contextWindow: 128000 },
  { name: "deepseek-v3", model: "deepseek-v3.1:671b-cloud", type: ModelType.CLOUD, description: "DeepSeek V3.1 671B - 思考推理", supportsTools: true, contextWindow: 128000 },
  { name: "minimax-m2", model: "minimax-m2:cloud", type: ModelType.CLOUD, description: "MiniMax M2 Cloud", supportsTools: false, contextWindow: 64000 },
  { name: "glm-4.6", model: "glm-4.6:cloud", type: ModelType.CLOUD, description: "GLM 4.6 Cloud", supportsTools: false, contextWindow: 128000 },
];

// 所有可用模型
export const ALL_MODELS: ModelConfig[] = [...LOCAL_MODELS, ...CLOUD_MODELS];

// 支持工具调用的模型
export const TOOL_CAPABLE_MODELS = ALL_MODELS.filter((m) => m.supportsTools);

// 默认模型（使用云端模型以获得更好的工具调用支持）
export const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-oss";

// 根据名称获取模型配置
export function getModelConfig(name: string): ModelConfig | undefined {
  return ALL_MODELS.find((m) => m.name === name || m.model === name);
}

// 检查模型是否支持工具调用
export function supportsToolCalling(name: string): boolean {
  const config = getModelConfig(name);
  return config?.supportsTools ?? false;
}

// 获取模型的上下文窗口大小
export function getModelContextWindow(name: string): number {
  const config = getModelConfig(name);
  return config?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

// 列出所有模型
export function listModels(): void {
  ui.system(`\nOllama Host: ${OLLAMA_HOST}`);
  ui.system(`API Key: ${OLLAMA_API_KEY ? "已配置 ✓" : "未配置 ✗"}`);
  ui.system(`默认模型: ${DEFAULT_MODEL}`);

  ui.heading("本地模型");
  LOCAL_MODELS.forEach((m) => {
    const toolIcon = m.supportsTools ? "🔧" : "  ";
    ui.listItem(`${toolIcon} ${m.name.padEnd(18)} - ${m.description || m.model}`);
  });

  ui.heading("云端模型 (推荐用于 Agent)");
  CLOUD_MODELS.forEach((m) => {
    const toolIcon = m.supportsTools ? "🔧" : "  ";
    ui.listItem(`${toolIcon} ${m.name.padEnd(18)} - ${m.description || m.model}`);
  });

  ui.info("🔧 = 支持工具调用");
  ui.newline();
}
