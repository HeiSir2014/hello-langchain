/**
 * Ollama Service - Dynamic model discovery using official ollama npm package
 *
 * Provides functions to list and get information about Ollama models
 * from both local and cloud instances.
 */

import { Ollama } from "ollama";
import { log } from "../../logger.js";
import { getSettings } from "../settings.js";

/**
 * 获取 Ollama 客户端
 */
function getLocalOllamaClient(): Ollama {
  const { ollama } = getSettings();
  return new Ollama({ host: ollama.host });
}

/**
 * 获取云端 Ollama 客户端（如果配置了 API Key）
 */
function getCloudOllamaClient(): Ollama | null {
  const { ollama } = getSettings();
  if (!ollama.cloudApiKey) {
    return null;
  }
  return new Ollama({
    host: ollama.cloudHost,
    headers: { Authorization: `Bearer ${ollama.cloudApiKey}` },
  });
}

// 解析后的模型配置
export interface ParsedOllamaModel {
  name: string;
  model: string;
  description: string;
  contextWindow: number;
  parameterSize: string;
  family: string;
  supportsTools: boolean;
  isCloud: boolean;
}

/**
 * 从 model_info 中提取上下文长度
 */
function extractContextLength(modelInfo: any): number {
  if (!modelInfo) {
    return 8192; // 默认值
  }

  // 尝试不同架构的 context_length 字段
  const contextKeys = Object.keys(modelInfo).filter(k => k.endsWith(".context_length"));
  for (const key of contextKeys) {
    const value = modelInfo[key];
    if (typeof value === "number" && value > 0) {
      return value;
    }
  }

  return 8192; // 默认值
}

/**
 * 判断模型是否支持工具调用
 * 基于模型的 capabilities 或家族来判断
 */
function supportsToolCalling(showResponse: any, family: string): boolean {
  // 如果有 capabilities 字段，检查是否包含 tools
  if (showResponse?.capabilities?.includes("tools")) {
    return true;
  }

  // 基于已知支持工具调用的模型家族
  const toolCapableFamilies = [
    "llama", // llama3+ 支持
    "qwen", "qwen2", "qwen3", // Qwen 系列支持
    "mistral", // Mistral 支持
    "command-r", // Cohere Command R 支持
    "deepseek", // DeepSeek 支持
    "yi", // Yi 支持
    "gptoss", // GPT-OSS 支持
    "glm", // GLM 支持
    "minimax", // MiniMax 支持
  ];

  return toolCapableFamilies.some(f => family.toLowerCase().includes(f));
}

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return "0MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)}GB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)}MB`;
}

/**
 * 从 Ollama 客户端获取模型列表并解析
 */
async function fetchAndParseModels(client: Ollama, isCloud: boolean): Promise<ParsedOllamaModel[]> {
  try {
    const listResponse = await client.list();
    const models = listResponse.models || [];

    log.info(`Fetched ${models.length} ${isCloud ? "cloud" : "local"} Ollama models`);

    // 并行获取每个模型的详细信息
    const parsedModels = await Promise.all(
      models.map(async (model): Promise<ParsedOllamaModel> => {
        let contextWindow = 8192;
        let capabilities: string[] = [];

        try {
          const showResponse = await client.show({ model: model.name });
          contextWindow = extractContextLength(showResponse.model_info);
          capabilities = showResponse.capabilities || [];
        } catch (error: any) {
          log.debug(`Failed to get show info for ${model.name}`, { error: error.message });
        }

        const family = model.details?.family || "unknown";
        const parameterSize = model.details?.parameter_size || "unknown";
        const size = formatSize(model.size || 0);

        return {
          name: model.name,
          model: model.model || model.name,
          description: `${family} ${parameterSize} (${size})`,
          contextWindow,
          parameterSize,
          family,
          supportsTools: supportsToolCalling({ capabilities }, family),
          isCloud,
        };
      })
    );

    return parsedModels;
  } catch (error: any) {
    log.error(`Failed to fetch ${isCloud ? "cloud" : "local"} Ollama models`, { error: error.message });
    return [];
  }
}

/**
 * 获取本地 Ollama 模型列表
 */
export async function listLocalModels(): Promise<ParsedOllamaModel[]> {
  return fetchAndParseModels(getLocalOllamaClient(), false);
}

/**
 * 获取云端 Ollama 模型列表
 */
export async function listCloudModels(): Promise<ParsedOllamaModel[]> {
  const cloudClient = getCloudOllamaClient();
  if (!cloudClient) {
    log.debug("No Ollama cloud API key configured, skipping cloud models");
    return [];
  }
  return fetchAndParseModels(cloudClient, true);
}

/**
 * 获取所有可用的 Ollama 模型（本地 + 云端）
 */
export async function getAllOllamaModels(): Promise<{
  local: ParsedOllamaModel[];
  cloud: ParsedOllamaModel[];
}> {
  log.info("Fetching Ollama models using official ollama package...");

  // 并行获取本地和云端模型
  const [local, cloud] = await Promise.all([
    listLocalModels(),
    listCloudModels(),
  ]);

  log.info("Ollama models fetched", {
    localCount: local.length,
    cloudCount: cloud.length,
  });

  return { local, cloud };
}

// ============ 缓存机制 ============

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

// 缓存文件路径
const CACHE_DIR = join(homedir(), ".yterm");
const CACHE_FILE = join(CACHE_DIR, "ollama-models-cache.json");

// 内存缓存
let cachedModels: { local: ParsedOllamaModel[]; cloud: ParsedOllamaModel[] } | null = null;
let cacheTimestamp: number = 0;

// 缓存 TTL
const MEMORY_CACHE_TTL = 60000; // 内存缓存 1 分钟
const FILE_CACHE_TTL = 3600000; // 文件缓存 1 小时

interface CacheData {
  timestamp: number;
  local: ParsedOllamaModel[];
  cloud: ParsedOllamaModel[];
}

/**
 * 从文件读取缓存
 */
function readCacheFromFile(): CacheData | null {
  try {
    if (!existsSync(CACHE_FILE)) {
      return null;
    }
    const data = readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(data) as CacheData;
  } catch (error) {
    log.debug("Failed to read cache file", { error });
    return null;
  }
}

/**
 * 写入缓存到文件
 */
function writeCacheToFile(data: { local: ParsedOllamaModel[]; cloud: ParsedOllamaModel[] }): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    const cacheData: CacheData = {
      timestamp: Date.now(),
      ...data,
    };
    writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    log.debug("Cache written to file");
  } catch (error) {
    log.debug("Failed to write cache file", { error });
  }
}

/**
 * 获取 Ollama 模型（带多级缓存）
 *
 * 缓存策略：
 * 1. 内存缓存（1分钟）- 最快
 * 2. 文件缓存（1小时）- 启动时使用，避免网络请求
 * 3. 网络请求 - 缓存失效时后台刷新
 */
export async function getOllamaModelsWithCache(): Promise<{
  local: ParsedOllamaModel[];
  cloud: ParsedOllamaModel[];
}> {
  const now = Date.now();

  // 1. 检查内存缓存
  if (cachedModels && (now - cacheTimestamp) < MEMORY_CACHE_TTL) {
    return cachedModels;
  }

  // 2. 检查文件缓存
  const fileCache = readCacheFromFile();
  if (fileCache && (now - fileCache.timestamp) < FILE_CACHE_TTL) {
    cachedModels = { local: fileCache.local, cloud: fileCache.cloud };
    cacheTimestamp = fileCache.timestamp;
    log.info("Using file cache for Ollama models", {
      localCount: fileCache.local.length,
      cloudCount: fileCache.cloud.length,
      age: Math.round((now - fileCache.timestamp) / 1000) + "s",
    });
    return cachedModels;
  }

  // 3. 从网络获取
  cachedModels = await getAllOllamaModels();
  cacheTimestamp = now;

  // 写入文件缓存
  writeCacheToFile(cachedModels);

  return cachedModels;
}

/**
 * 快速获取缓存的模型（不触发网络请求）
 * 用于启动时快速加载，返回 null 表示无缓存
 */
export function getCachedModelsSync(): { local: ParsedOllamaModel[]; cloud: ParsedOllamaModel[] } | null {
  // 先检查内存
  if (cachedModels) {
    return cachedModels;
  }

  // 再检查文件
  const fileCache = readCacheFromFile();
  if (fileCache) {
    cachedModels = { local: fileCache.local, cloud: fileCache.cloud };
    cacheTimestamp = fileCache.timestamp;
    return cachedModels;
  }

  return null;
}

/**
 * 后台刷新模型缓存（不阻塞）
 */
export function refreshModelsInBackground(): void {
  getAllOllamaModels().then((models) => {
    cachedModels = models;
    cacheTimestamp = Date.now();
    writeCacheToFile(models);
    log.info("Background model refresh completed", {
      localCount: models.local.length,
      cloudCount: models.cloud.length,
    });
  }).catch((error) => {
    log.debug("Background model refresh failed", { error: error.message });
  });
}

/**
 * 清除模型缓存
 */
export function clearOllamaModelCache(): void {
  cachedModels = null;
  cacheTimestamp = 0;
  // 不删除文件缓存，只清除内存
}
