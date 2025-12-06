import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getSettings, type Settings } from "./settings.js";
import { log } from "../logger.js";

// 获取 YTerm 安装目录（即本项目根目录）
// ESM 中使用 import.meta.url 替代 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const YTerm_ROOT = resolve(__dirname, "..");

// 加载环境变量，优先级（从高到低）：
// 1. settings.json (最高优先级，在 getSettings() 中处理)
// 2. 当前工作目录的 .env.local
// 3. 当前工作目录的 .env
// 4. YTerm 安装目录的 .env.local
// 5. YTerm 安装目录的 .env
// dotenv 不会覆盖已存在的环境变量，所以按优先级从高到低加载
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });
config({ path: resolve(YTerm_ROOT, ".env.local"), quiet: true });
config({ path: resolve(YTerm_ROOT, ".env"), quiet: true });

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

// ============ 配置访问器（从 settings 获取） ============

// 获取当前 Provider
export function getUseProvider(): ProviderType {
  return getSettings().provider as ProviderType;
}

// 获取当前默认模型（根据当前 provider 动态获取）
export function getDefaultModel(): string {
  const settings = getSettings();
  
  switch (settings.provider) {
    case "OLLAMA":
      return settings.ollama.model;
    case "OPENROUTER":
      return settings.openRouter.model;
    case "OPENAI":
      return settings.openAI.model;
    case "ANTHROPIC":
      return settings.anthropic.model;
    default:
      return settings.ollama.model;
  }
}

// Ollama 配置
export function getOllamaHost(): string {
  return getSettings().ollama.host;
}

export function getOllamaCloudHost(): string {
  return getSettings().ollama.cloudHost;
}

export function getOllamaCloudApiKey(): string {
  return getSettings().ollama.cloudApiKey;
}

// OpenRouter 配置
export function getOpenRouterApiKey(): string {
  return getSettings().openRouter.apiKey;
}

export function getOpenRouterModel(): string {
  return getSettings().openRouter.model;
}

export function getOpenRouterContextLength(): number {
  return getSettings().openRouter.contextLength;
}

// OpenAI 配置
export function getOpenAIApiKey(): string {
  return getSettings().openAI.apiKey;
}

export function getOpenAIBaseUrl(): string {
  return getSettings().openAI.baseUrl;
}

export function getOpenAIModel(): string {
  return getSettings().openAI.model;
}

export function getOpenAIContextLength(): number {
  return getSettings().openAI.contextLength;
}

// Anthropic 配置
export function getAnthropicApiKey(): string {
  return getSettings().anthropic.apiKey;
}

export function getAnthropicBaseUrl(): string {
  return getSettings().anthropic.baseUrl;
}

export function getAnthropicModel(): string {
  return getSettings().anthropic.model;
}

export function getAnthropicContextLength(): number {
  return getSettings().anthropic.contextLength;
}

// ============ 导出 ============

// 使用 getter 函数，这样可以动态获取最新设置
export const USE_PROVIDER = getUseProvider();
// 注意：OLLAMA_MODEL_NAME 现在表示当前使用的模型（根据 provider 动态变化）
export const CURRENT_MODEL_NAME = getDefaultModel();
export const OLLAMA_HOST = getOllamaHost();
export const OLLAMA_CLOUD_HOST = getOllamaCloudHost();
export const OLLAMA_CLOUD_API_KEY = getOllamaCloudApiKey();
export const OPENROUTER_API_KEY = getOpenRouterApiKey();
export const OPENROUTER_MODEL_NAME = getOpenRouterModel();
export const OPENROUTER_MODEL_CONTEXT_LENGTH = getOpenRouterContextLength();
export const OPENAI_API_KEY = getOpenAIApiKey();
export const OPENAI_MODEL_NAME = getOpenAIModel();
export const OPENAI_MODEL_CONTEXT_LENGTH = getOpenAIContextLength();
export const ANTHROPIC_API_KEY = getAnthropicApiKey();
export const ANTHROPIC_MODEL_NAME = getAnthropicModel();
export const ANTHROPIC_MODEL_CONTEXT_LENGTH = getAnthropicContextLength();

// 默认上下文窗口大小
export const DEFAULT_CONTEXT_WINDOW = 32768;

// ============ 动态 Ollama 模型 ============
// Ollama 模型通过 API 动态获取，不再硬编码

// 本地 Ollama 模型（动态填充）
export let LOCAL_MODELS: ModelConfig[] = [];

// 云端 Ollama 模型（动态填充）
export let CLOUD_MODELS: ModelConfig[] = [];

// ============ 其他 Provider 模型配置 ============

// OpenRouter 模型（动态获取）
export let OPENROUTER_MODELS: ModelConfig[] = [];

// OpenAI 模型（动态获取）
export let OPENAI_MODELS: ModelConfig[] = [];

// Anthropic 模型（静态列表，但使用缓存）
export let ANTHROPIC_MODELS: ModelConfig[] = [];

// 所有可用模型（会在初始化后更新）
export let ALL_MODELS: ModelConfig[] = [];

// 支持工具调用的模型
export function getToolCapableModels(): ModelConfig[] {
  return ALL_MODELS.filter((m) => m.supportsTools);
}

// ============ 初始化函数 ============

import {
  getOllamaModelsWithCache,
  getCachedModelsSync,
  refreshModelsInBackground,
  type ParsedOllamaModel,
} from "./services/ollama.js";

import {
  getOpenRouterModelsWithCache,
  getCachedOpenRouterModelsSync,
  refreshOpenRouterModelsInBackground,
  type ParsedOpenRouterModel,
} from "./services/openrouter.js";

import {
  getOpenAIModelsWithCache,
  getCachedOpenAIModelsSync,
  refreshOpenAIModelsInBackground,
  type ParsedOpenAIModel,
} from "./services/openai.js";

import {
  getAnthropicModelsWithCache,
  getCachedAnthropicModelsSync,
  refreshAnthropicModelsInBackground,
  type ParsedAnthropicModel,
} from "./services/anthropic.js";

/**
 * 将 ParsedOllamaModel 转换为 ModelConfig
 */
function toModelConfig(parsed: ParsedOllamaModel): ModelConfig {
  return {
    name: parsed.name,
    model: parsed.model,
    type: parsed.isCloud ? ModelType.CLOUD : ModelType.LOCAL,
    description: parsed.description,
    supportsTools: parsed.supportsTools,
    contextWindow: parsed.contextWindow,
    provider: ProviderType.OLLAMA,
  };
}

/**
 * 将 ParsedOpenRouterModel 转换为 ModelConfig
 */
function toOpenRouterModelConfig(parsed: ParsedOpenRouterModel): ModelConfig {
  return {
    name: parsed.name,
    model: parsed.model,
    type: ModelType.CLOUD,
    description: parsed.description,
    supportsTools: parsed.supportsTools,
    contextWindow: parsed.contextWindow,
    provider: ProviderType.OPENROUTER,
  };
}

/**
 * 将 ParsedOpenAIModel 转换为 ModelConfig
 */
function toOpenAIModelConfig(parsed: ParsedOpenAIModel): ModelConfig {
  return {
    name: parsed.name,
    model: parsed.model,
    type: ModelType.CLOUD,
    description: parsed.description,
    supportsTools: parsed.supportsTools,
    contextWindow: parsed.contextWindow,
    provider: ProviderType.OPENAI,
  };
}

/**
 * 将 ParsedAnthropicModel 转换为 ModelConfig
 */
function toAnthropicModelConfig(parsed: ParsedAnthropicModel): ModelConfig {
  return {
    name: parsed.name,
    model: parsed.model,
    type: ModelType.CLOUD,
    description: parsed.description,
    supportsTools: parsed.supportsTools,
    contextWindow: parsed.contextWindow,
    provider: ProviderType.ANTHROPIC,
  };
}



/**
 * 更新模型列表
 */
function updateModelLists(
  local: ParsedOllamaModel[], 
  cloud: ParsedOllamaModel[],
  openRouterModels: ParsedOpenRouterModel[],
  openAIModels: ParsedOpenAIModel[],
  anthropicModels: ParsedAnthropicModel[]
): void {
  LOCAL_MODELS = local.map(toModelConfig);
  CLOUD_MODELS = cloud.map(toModelConfig);
  OPENROUTER_MODELS = openRouterModels.map(toOpenRouterModelConfig);
  OPENAI_MODELS = openAIModels.map(toOpenAIModelConfig);
  ANTHROPIC_MODELS = anthropicModels.map(toAnthropicModelConfig);
  
  ALL_MODELS = [...LOCAL_MODELS, ...CLOUD_MODELS, ...OPENROUTER_MODELS, ...OPENAI_MODELS, ...ANTHROPIC_MODELS];
  
  log.debug("All models updated", {
    local: LOCAL_MODELS.length,
    cloud: CLOUD_MODELS.length,
    openRouter: OPENROUTER_MODELS.length,
    openAI: OPENAI_MODELS.length,
    anthropic: ANTHROPIC_MODELS.length,
    total: ALL_MODELS.length,
  });
}

/**
 * 快速初始化模型配置（使用缓存，不阻塞）
 * 用于启动时快速加载，后台刷新缓存
 */
export function initializeModelsSync(): void {
  // 检查缓存
  const cachedOllama = getCachedModelsSync();
  const cachedOpenRouter = getCachedOpenRouterModelsSync();
  const cachedOpenAI = getCachedOpenAIModelsSync();
  const cachedAnthropic = getCachedAnthropicModelsSync();

  if (cachedOllama || cachedOpenRouter || cachedOpenAI || cachedAnthropic) {
    updateModelLists(
      cachedOllama?.local || [],
      cachedOllama?.cloud || [],
      cachedOpenRouter || [],
      cachedOpenAI || [],
      cachedAnthropic || []
    );
    // 后台刷新缓存
    refreshModelsInBackground();
    refreshOpenRouterModelsInBackground();
    refreshOpenAIModelsInBackground();
    refreshAnthropicModelsInBackground();
  } else {
    // 没有缓存时，后台获取（启动时不阻塞）
    refreshModelsInBackground();
    refreshOpenRouterModelsInBackground();
    refreshOpenAIModelsInBackground();
    refreshAnthropicModelsInBackground();
  }
}

/**
 * 初始化模型配置（异步，等待完成）
 * 用于需要完整模型列表的场景（如 --list）
 */
export async function initializeModels(): Promise<void> {
  try {
    // 并行获取需要动态获取的模型
    const [ollamaResult, openRouterModels, openAIModels, anthropicModels] = await Promise.all([
      getOllamaModelsWithCache(),
      getOpenRouterModelsWithCache(),
      getOpenAIModelsWithCache(),
      getAnthropicModelsWithCache(),
    ]);

    updateModelLists(
      ollamaResult.local,
      ollamaResult.cloud,
      openRouterModels,
      openAIModels,
      anthropicModels
    );

    console.log(`Loaded models:`);
    console.log(`  Ollama: ${LOCAL_MODELS.length} local + ${CLOUD_MODELS.length} cloud`);
    console.log(`  OpenRouter: ${OPENROUTER_MODELS.length}`);
    console.log(`  OpenAI: ${OPENAI_MODELS.length}`);
    console.log(`  Anthropic: ${ANTHROPIC_MODELS.length}`);
    console.log(`  Total: ${ALL_MODELS.length} models`);
  } catch (error: any) {
    console.error("Failed to initialize models:", error.message);
  }
}

/**
 * 刷新所有模型列表
 */
export async function refreshAllModels(): Promise<void> {
  try {
    const { clearOllamaModelCache } = await import("./services/ollama.js");
    const { clearOpenRouterModelCache } = await import("./services/openrouter.js");
    const { clearOpenAIModelCache } = await import("./services/openai.js");
    const { clearAnthropicModelCache } = await import("./services/anthropic.js");

    // 清除所有服务的缓存
    clearOllamaModelCache();
    clearOpenRouterModelCache();
    clearOpenAIModelCache();
    clearAnthropicModelCache();

    // 重新初始化
    await initializeModels();
    
    console.log("All models refreshed successfully");
  } catch (error: any) {
    console.error("Failed to refresh models:", error.message);
  }
}

/**
 * 刷新 Ollama 模型列表（向后兼容）
 */
export async function refreshOllamaModels(): Promise<void> {
  await refreshAllModels();
}

// ============ 模型查询函数 ============

// 根据名称获取模型配置
// 优先匹配当前 Provider 下的模型，避免跨 Provider 的名称冲突
export function getModelConfig(name: string): ModelConfig | undefined {
  const currentProvider = getUseProvider();

  // 先在当前 Provider 的模型中查找
  const currentProviderModels = ALL_MODELS.filter(m => m.provider === currentProvider);
  const matchInProvider = currentProviderModels.find((m) => m.name === name || m.model === name);
  if (matchInProvider) {
    return matchInProvider;
  }

  // 在所有模型中查找
  const matchInAll = ALL_MODELS.find((m) => m.name === name || m.model === name);
  if (matchInAll) {
    return matchInAll;
  }

  // 如果都没找到，创建动态配置
  // 这允许用户使用任意模型名称，并自动绑定到当前 Provider
  return {
    name,
    model: name,
    type: ModelType.CLOUD,
    description: `${currentProvider} - ${name}`,
    supportsTools: true,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    provider: currentProvider,
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
  const currentProvider = getUseProvider();
  const currentModel = getDefaultModel();
  console.log(`\nProvider: ${currentProvider}`);
  console.log(`Default Model: ${currentModel}`);
  console.log(`\nAvailable Models:`);

  const printModels = (models: ModelConfig[], category: string) => {
    if (models.length === 0) return;
    console.log(`\n[${category}]`);
    models.forEach((m) => {
      const toolIcon = m.supportsTools ? "🔧" : "  ";
      const ctx = m.contextWindow ? ` (${Math.round(m.contextWindow / 1000)}K ctx)` : "";
      console.log(`  ${toolIcon} ${m.name.padEnd(25)} ${m.description || m.model}${ctx}`);
    });
  };

  printModels(LOCAL_MODELS, "Ollama Local");
  printModels(CLOUD_MODELS, "Ollama Cloud");
  printModels(OPENROUTER_MODELS, "OpenRouter");
  printModels(OPENAI_MODELS, "OpenAI");
  printModels(ANTHROPIC_MODELS, "Anthropic");

  console.log("\n🔧 = supports tool calling");
  console.log("\nTotal Models:");
  console.log(`  Local: ${LOCAL_MODELS.length}`);
  console.log(`  Cloud: ${CLOUD_MODELS.length + OPENROUTER_MODELS.length + OPENAI_MODELS.length + ANTHROPIC_MODELS.length}`);
  console.log(`  All: ${ALL_MODELS.length}\n`);
}
