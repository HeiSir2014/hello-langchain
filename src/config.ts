import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ui } from "./ui.js";

// 获取 yterm 安装目录（即本项目根目录）
// ESM 中使用 import.meta.url 替代 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const YTERM_ROOT = resolve(__dirname, "..");

// 加载环境变量，优先级（从高到低）：
// 1. 当前工作目录的 .env.local
// 2. 当前工作目录的 .env
// 3. yterm 安装目录的 .env.local
// 4. yterm 安装目录的 .env
// dotenv 不会覆盖已存在的环境变量，所以按优先级从高到低加载
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });
config({ path: resolve(YTERM_ROOT, ".env.local"), quiet: true });
config({ path: resolve(YTERM_ROOT, ".env"), quiet: true });

// 模型类型枚举
export enum ModelType {
  LOCAL = "local",
  CLOUD = "cloud",
}

// Provider 类型枚举
export enum ProviderType {
  OLLAMA = "OLLAMA",
  OPENROUTER = "OPENROUTER",
  OPENAI = "OPENAI",
  ANTHROPIC = "ANTHROPIC",
}

export interface ModelConfig {
  name: string;
  model: string;
  type: ModelType;
  description?: string;
  supportsTools?: boolean; // 是否支持工具调用
  contextWindow?: number;  // 上下文窗口大小（tokens）
  provider?: ProviderType; // 模型提供者
}

// Provider 配置
export const USE_PROVIDER = (process.env.USE_PROVIDER || "OLLAMA").toUpperCase() as ProviderType;

// Ollama 配置
export const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
export const OLLAMA_CLOUD_HOST = process.env.OLLAMA_CLOUD_HOST || "https://ollama.com";
export const OLLAMA_CLOUD_API_KEY = process.env.OLLAMA_CLOUD_API_KEY || process.env.OLLAMA_API_KEY || "";

// OpenRouter 配置
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
export const OPENROUTER_MODEL_NAME = process.env.OPENROUTER_MODEL_NAME || "x-ai/grok-2-1212";
export const OPENROUTER_MODEL_CONTEXT_LENGTH = Number(process.env.OPENROUTER_MODEL_CONTEXT_LENGTH) || 131072;

// OpenAI 配置
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const OPENAI_MODEL_NAME = process.env.OPENAI_MODEL_NAME || "gpt-4o";
export const OPENAI_MODEL_CONTEXT_LENGTH = Number(process.env.OPENAI_MODEL_CONTEXT_LENGTH) || 128000;

// Anthropic 配置
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
export const ANTHROPIC_MODEL_NAME = process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-20250514";
export const ANTHROPIC_MODEL_CONTEXT_LENGTH = Number(process.env.ANTHROPIC_MODEL_CONTEXT_LENGTH) || 200000;

// 默认上下文窗口大小
export const DEFAULT_CONTEXT_WINDOW = 32768;

// 本地安装的 Ollama 模型
export const LOCAL_MODELS: ModelConfig[] = [
  { name: "qwen3:4b", model: "qwen3:4b", type: ModelType.LOCAL, description: "Qwen3 4B - 轻量级", supportsTools: true, contextWindow: 32768, provider: ProviderType.OLLAMA },
  { name: "qwen3:8b", model: "qwen3:8b", type: ModelType.LOCAL, description: "Qwen3 8B", supportsTools: true, contextWindow: 32768, provider: ProviderType.OLLAMA },
  { name: "qwen3:0.6b", model: "qwen3:0.6b", type: ModelType.LOCAL, description: "Qwen3 0.6B - 最小", supportsTools: false, contextWindow: 8192, provider: ProviderType.OLLAMA },
  { name: "qwen3-coder", model: "qwen3-coder:latest", type: ModelType.LOCAL, description: "Qwen3 Coder 18GB", supportsTools: true, contextWindow: 32768, provider: ProviderType.OLLAMA },
  { name: "gemma3:4b", model: "gemma3:4b", type: ModelType.LOCAL, description: "Gemma3 4B", supportsTools: false, contextWindow: 8192, provider: ProviderType.OLLAMA },
];

// Ollama Cloud 模型（支持 Tool Calling）
export const CLOUD_MODELS: ModelConfig[] = [
  { name: "gpt-oss", model: "gpt-oss:120b-cloud", type: ModelType.CLOUD, description: "GPT-OSS 120B - 推理 & Agent", supportsTools: true, contextWindow: 128000, provider: ProviderType.OLLAMA },
  { name: "qwen3-coder-480b", model: "qwen3-coder:480b-cloud", type: ModelType.CLOUD, description: "Qwen3 Coder 480B - 编码专用", supportsTools: true, contextWindow: 128000, provider: ProviderType.OLLAMA },
  { name: "qwen3-vl", model: "qwen3-vl:235b-cloud", type: ModelType.CLOUD, description: "Qwen3 VL 235B - 视觉语言", supportsTools: true, contextWindow: 160000, provider: ProviderType.OLLAMA },
  { name: "qwen3-vl-instruct", model: "qwen3-vl:235b-instruct-cloud", type: ModelType.CLOUD, description: "Qwen3 VL Instruct 235B - 视觉语言", supportsTools: true, contextWindow: 160000, provider: ProviderType.OLLAMA },
  { name: "deepseek-v3", model: "deepseek-v3.1:671b-cloud", type: ModelType.CLOUD, description: "DeepSeek V3.1 671B - 思考推理", supportsTools: true, contextWindow: 160000, provider: ProviderType.OLLAMA },
  { name: "minimax-m2", model: "minimax-m2:cloud", type: ModelType.CLOUD, description: "MiniMax M2 Cloud", supportsTools: true, contextWindow: 200000, provider: ProviderType.OLLAMA },
  { name: "glm-4.6", model: "glm-4.6:cloud", type: ModelType.CLOUD, description: "GLM 4.6 Cloud", supportsTools: true, contextWindow: 198000, provider: ProviderType.OLLAMA },
];

// OpenRouter 模型
export const OPENROUTER_MODELS: ModelConfig[] = [
  { name: "openrouter", model: OPENROUTER_MODEL_NAME, type: ModelType.CLOUD, description: `OpenRouter - ${OPENROUTER_MODEL_NAME}`, supportsTools: true, contextWindow: OPENROUTER_MODEL_CONTEXT_LENGTH, provider: ProviderType.OPENROUTER },
];

// OpenAI 模型
export const OPENAI_MODELS: ModelConfig[] = [
  { name: "gpt-4o", model: OPENAI_MODEL_NAME, type: ModelType.CLOUD, description: `OpenAI - ${OPENAI_MODEL_NAME}`, supportsTools: true, contextWindow: OPENAI_MODEL_CONTEXT_LENGTH, provider: ProviderType.OPENAI },
  { name: "gpt-4o-mini", model: "gpt-4o-mini", type: ModelType.CLOUD, description: "OpenAI GPT-4o Mini", supportsTools: true, contextWindow: 128000, provider: ProviderType.OPENAI },
  { name: "gpt-4-turbo", model: "gpt-4-turbo", type: ModelType.CLOUD, description: "OpenAI GPT-4 Turbo", supportsTools: true, contextWindow: 128000, provider: ProviderType.OPENAI },
  { name: "gpt-3.5-turbo", model: "gpt-3.5-turbo", type: ModelType.CLOUD, description: "OpenAI GPT-3.5 Turbo", supportsTools: true, contextWindow: 16385, provider: ProviderType.OPENAI },
];

// Anthropic 模型
export const ANTHROPIC_MODELS: ModelConfig[] = [
  { name: "claude-sonnet", model: ANTHROPIC_MODEL_NAME, type: ModelType.CLOUD, description: `Anthropic - ${ANTHROPIC_MODEL_NAME}`, supportsTools: true, contextWindow: ANTHROPIC_MODEL_CONTEXT_LENGTH, provider: ProviderType.ANTHROPIC },
  { name: "claude-3-5-sonnet", model: "claude-3-5-sonnet-20241022", type: ModelType.CLOUD, description: "Anthropic Claude 3.5 Sonnet", supportsTools: true, contextWindow: 200000, provider: ProviderType.ANTHROPIC },
  { name: "claude-3-opus", model: "claude-3-opus-20240229", type: ModelType.CLOUD, description: "Anthropic Claude 3 Opus", supportsTools: true, contextWindow: 200000, provider: ProviderType.ANTHROPIC },
  { name: "claude-3-haiku", model: "claude-3-haiku-20240307", type: ModelType.CLOUD, description: "Anthropic Claude 3 Haiku", supportsTools: true, contextWindow: 200000, provider: ProviderType.ANTHROPIC },
];

// 所有可用模型
export const ALL_MODELS: ModelConfig[] = [...LOCAL_MODELS, ...CLOUD_MODELS, ...OPENROUTER_MODELS, ...OPENAI_MODELS, ...ANTHROPIC_MODELS];

// 支持工具调用的模型
export const TOOL_CAPABLE_MODELS = ALL_MODELS.filter((m) => m.supportsTools);

// 默认模型（根据 USE_PROVIDER 选择）
export const DEFAULT_MODEL = process.env.DEFAULT_MODEL || (USE_PROVIDER === ProviderType.OPENROUTER ? "openrouter" : "gpt-oss");

// 根据名称获取模型配置
// 优先匹配当前 USE_PROVIDER 下的模型，避免跨 Provider 的名称冲突
export function getModelConfig(name: string): ModelConfig | undefined {
  // 先在当前 Provider 的模型中查找
  const currentProviderModels = ALL_MODELS.filter(m => m.provider === USE_PROVIDER);
  const matchInProvider = currentProviderModels.find((m) => m.name === name || m.model === name);
  if (matchInProvider) {
    return matchInProvider;
  }

  // 如果当前 Provider 没有这个模型，创建动态配置
  // 这允许用户使用任意模型名称，并自动绑定到当前 Provider
  return {
    name,
    model: name,
    type: ModelType.CLOUD,
    description: `${USE_PROVIDER} - ${name}`,
    supportsTools: true,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    provider: USE_PROVIDER,
  };
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
  ui.system(`\n当前 Provider: ${USE_PROVIDER}`);
  ui.system(`Ollama Host: ${OLLAMA_HOST}`);
  ui.system(`Ollama Cloud Host: ${OLLAMA_CLOUD_HOST}`);
  ui.system(`Ollama Cloud API Key: ${OLLAMA_CLOUD_API_KEY ? "已配置 ✓" : "未配置 ✗"}`);
  ui.system(`OpenRouter API Key: ${OPENROUTER_API_KEY ? "已配置 ✓" : "未配置 ✗"}`);
  ui.system(`OpenAI API Key: ${OPENAI_API_KEY ? "已配置 ✓" : "未配置 ✗"}`);
  ui.system(`Anthropic API Key: ${ANTHROPIC_API_KEY ? "已配置 ✓" : "未配置 ✗"}`);
  ui.system(`默认模型: ${DEFAULT_MODEL}`);

  ui.heading("本地模型 (Ollama)");
  LOCAL_MODELS.forEach((m) => {
    const toolIcon = m.supportsTools ? "🔧" : "  ";
    ui.listItem(`${toolIcon} ${m.name.padEnd(18)} - ${m.description || m.model}`);
  });

  ui.heading("云端模型 (Ollama Cloud)");
  CLOUD_MODELS.forEach((m) => {
    const toolIcon = m.supportsTools ? "🔧" : "  ";
    ui.listItem(`${toolIcon} ${m.name.padEnd(18)} - ${m.description || m.model}`);
  });

  ui.heading("OpenRouter 模型");
  OPENROUTER_MODELS.forEach((m) => {
    const toolIcon = m.supportsTools ? "🔧" : "  ";
    ui.listItem(`${toolIcon} ${m.name.padEnd(18)} - ${m.description || m.model}`);
  });

  ui.heading("OpenAI 模型");
  OPENAI_MODELS.forEach((m) => {
    const toolIcon = m.supportsTools ? "🔧" : "  ";
    ui.listItem(`${toolIcon} ${m.name.padEnd(18)} - ${m.description || m.model}`);
  });

  ui.heading("Anthropic 模型");
  ANTHROPIC_MODELS.forEach((m) => {
    const toolIcon = m.supportsTools ? "🔧" : "  ";
    ui.listItem(`${toolIcon} ${m.name.padEnd(18)} - ${m.description || m.model}`);
  });

  ui.info("🔧 = 支持工具调用");
  ui.newline();
}
