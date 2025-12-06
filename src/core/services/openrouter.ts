/**
 * OpenRouter Service - Dynamic model discovery using OpenRouter API
 *
 * Provides functions to list and get information about OpenRouter models
 * from their official API endpoint.
 */

import { log } from "../../logger.js";
import { getSettings } from "../settings.js";

// API 端点
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// 解析后的模型配置
export interface ParsedOpenRouterModel {
  name: string;
  model: string;
  description: string;
  contextWindow: number;
  pricing: string;
  topProvider: string;
  supportsTools: boolean;
  perRequestLimits?: string;
}

/**
 * 判断模型是否支持工具调用
 * 基于 OpenRouter 的 top_provider.capabilities
 */
function supportsToolCalling(capabilities: string[]): boolean {
  // OpenRouter 文档中，工具调用的 capability 标记
  // https://openrouter.ai/docs#tool-use
  return capabilities.includes("tools");
}

/**
 * 获取模型定价信息
 */
function getPricingInfo(pricing: any): string {
  if (!pricing) return "Unknown";
  
  const prompt = pricing.prompt || 0;
  const completion = pricing.completion || 0;
  
  // 转换为美元每百万 tokens
  const promptPerM = (prompt * 1000000).toFixed(4);
  const completionPerM = (completion * 1000000).toFixed(4);
  
  return `$${promptPerM}/1M prompt, $${completionPerM}/1M completion`;
}

/**
 * 从 OpenRouter API 获取模型列表并解析
 */
async function fetchAndParseModels(): Promise<ParsedOpenRouterModel[]> {
  try {
    const { openRouter } = getSettings();
    
    const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      headers: {
        "Authorization": `Bearer ${openRouter.apiKey}`,
        "HTTP-Referer": "https://github.com/HeiSir2014/hello-langchain",
        "X-Title": "YTerm",
      },
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const models = data.data || [];

    log.info(`Fetched ${models.length} OpenRouter models`);

    const parsedModels: ParsedOpenRouterModel[] = models
      .filter((model: any) => {
        // 过滤掉一些无效或过时的模型
        return model.id && model.name && !model.deprecated;
      })
      .map((model: any): ParsedOpenRouterModel => {
        const contextLength = model.context_length || 8192;
        const pricing = model.pricing || {};
        const topProvider = model.top_provider || {};
        const capabilities = topProvider.capabilities || [];

        return {
          name: model.id,
          model: model.id,
          description: model.description || model.name || model.id,
          contextWindow: contextLength,
          pricing: getPricingInfo(pricing),
          topProvider: topProvider.provider || "unknown",
          supportsTools: supportsToolCalling(capabilities),
          perRequestLimits: topProvider.per_request_limits ? 
            JSON.stringify(topProvider.per_request_limits) : undefined,
        };
      })
      // 按名称排序
      .sort((a: ParsedOpenRouterModel, b: ParsedOpenRouterModel) => 
        a.name.localeCompare(b.name)
      );

    return parsedModels;
  } catch (error: any) {
    log.error("Failed to fetch OpenRouter models", { error: error.message });
    return [];
  }
}

/**
 * 获取所有可用的 OpenRouter 模型
 */
export async function getAllOpenRouterModels(): Promise<ParsedOpenRouterModel[]> {
  const { openRouter } = getSettings();
  
  // 检查 API Key 是否配置
  if (!openRouter.apiKey) {
    log.debug("No OpenRouter API key configured, skipping OpenRouter models");
    return [];
  }

  log.info("Fetching OpenRouter models from API...");
  const models = await fetchAndParseModels();
  
  log.info("OpenRouter models fetched", {
    count: models.length,
    toolCapable: models.filter(m => m.supportsTools).length,
  });

  return models;
}

// ============ 缓存机制 ============

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// 缓存文件路径
const CACHE_DIR = join(homedir(), ".yterm");
const CACHE_FILE = join(CACHE_DIR, "openrouter-models-cache.json");

// 内存缓存
let cachedModels: ParsedOpenRouterModel[] | null = null;
let cacheTimestamp: number = 0;

// 缓存 TTL
const MEMORY_CACHE_TTL = 60000; // 内存缓存 1 分钟
const FILE_CACHE_TTL = 3600000; // 文件缓存 1 小时

interface CacheData {
  timestamp: number;
  models: ParsedOpenRouterModel[];
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
    log.debug("Failed to read OpenRouter cache file", { error });
    return null;
  }
}

/**
 * 写入缓存到文件
 */
function writeCacheToFile(models: ParsedOpenRouterModel[]): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    const cacheData: CacheData = {
      timestamp: Date.now(),
      models,
    };
    writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    log.debug("OpenRouter cache written to file");
  } catch (error) {
    log.debug("Failed to write OpenRouter cache file", { error });
  }
}

/**
 * 获取 OpenRouter 模型（带多级缓存）
 *
 * 缓存策略：
 * 1. 内存缓存（1分钟）- 最快
 * 2. 文件缓存（1小时）- 启动时使用，避免网络请求
 * 3. 网络请求 - 缓存失效时后台刷新
 */
export async function getOpenRouterModelsWithCache(): Promise<ParsedOpenRouterModel[]> {
  const now = Date.now();

  // 1. 检查内存缓存
  if (cachedModels && (now - cacheTimestamp) < MEMORY_CACHE_TTL) {
    return cachedModels;
  }

  // 2. 检查文件缓存
  const fileCache = readCacheFromFile();
  if (fileCache && (now - fileCache.timestamp) < FILE_CACHE_TTL) {
    cachedModels = fileCache.models;
    cacheTimestamp = fileCache.timestamp;
    log.info("Using file cache for OpenRouter models", {
      count: fileCache.models.length,
      age: Math.round((now - fileCache.timestamp) / 1000) + "s",
    });
    return cachedModels;
  }

  // 3. 从网络获取
  cachedModels = await getAllOpenRouterModels();
  cacheTimestamp = now;

  // 写入文件缓存
  writeCacheToFile(cachedModels);

  return cachedModels;
}

/**
 * 快速获取缓存的模型（不触发网络请求）
 * 用于启动时快速加载，返回 null 表示无缓存
 */
export function getCachedOpenRouterModelsSync(): ParsedOpenRouterModel[] | null {
  // 先检查内存
  if (cachedModels) {
    return cachedModels;
  }

  // 再检查文件
  const fileCache = readCacheFromFile();
  if (fileCache) {
    cachedModels = fileCache.models;
    cacheTimestamp = fileCache.timestamp;
    return cachedModels;
  }

  return null;
}

/**
 * 后台刷新模型缓存（不阻塞）
 */
export function refreshOpenRouterModelsInBackground(): void {
  getAllOpenRouterModels().then((models) => {
    cachedModels = models;
    cacheTimestamp = Date.now();
    writeCacheToFile(models);
    log.info("Background OpenRouter model refresh completed", {
      count: models.length,
      toolCapable: models.filter(m => m.supportsTools).length,
    });
  }).catch((error) => {
    log.debug("Background OpenRouter model refresh failed", { error: error.message });
  });
}

/**
 * 清除模型缓存
 */
export function clearOpenRouterModelCache(): void {
  cachedModels = null;
  cacheTimestamp = 0;
  // 不删除文件缓存，只清除内存
}
