/**
 * ID Remapper - 结构化字段防幻觉中间件
 *
 * LLM 在 tool_use/tool_result 场景中无法精确复制 URL、UUID 等高熵字符串。
 * BoundaryML 基准测试显示 UUID 错误率约 50%。
 *
 * 本模块实现"整数重映射 + 占位符"模式：
 * - Pre-processing: 将 tool_result 中的 URL/UUID 替换为短占位符 (REF-1, REF-2...)
 * - Post-processing: 从模型输出中还原占位符为真实值
 *
 * 参考：BoundaryML UUID Swap 研究、Perplexity 编号引用系统、Nikhil Verma 占位符模式
 */

// ============ 类型定义 ============

/** 单个映射条目 */
export interface RemapEntry {
  /** 占位符标识符, e.g. "REF-1" */
  placeholder: string;
  /** 原始值 (URL, UUID, etc.) */
  original: string;
  /** 值类型 */
  type: "url" | "uuid" | "path" | "hash" | "id";
  /** 来源 tool name */
  source?: string;
}

/** 重映射会话 - 维护一轮 agent 交互的映射状态 */
export interface RemapSession {
  /** 占位符 → 原始值 */
  placeholderToOriginal: Map<string, string>;
  /** 原始值 → 占位符 */
  originalToPlaceholder: Map<string, string>;
  /** 所有条目（有序） */
  entries: RemapEntry[];
  /** 下一个占位符编号 */
  nextId: number;
}

// ============ 正则模式 ============

/** URL 匹配 - 含路径和查询参数的完整 URL */
const URL_PATTERN = /https?:\/\/[^\s"'<>\])\},;]+/g;

/** UUID v4 匹配 */
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Git commit hash (7-40 hex chars, word boundary) */
const HASH_PATTERN = /\b[0-9a-f]{40}\b/gi;

/** 通用长 ID 模式 (至少 16 个字母数字+连字符) */
const LONG_ID_PATTERN = /\b[a-zA-Z0-9_-]{20,}\b/g;

/** 文件路径 (Unix absolute paths) */
const ABSOLUTE_PATH_PATTERN = /(?:\/[\w.@-]+){3,}/g;

/** 占位符模式 - 用于从模型输出中提取引用 */
const PLACEHOLDER_PATTERN = /\bREF-(\d+)\b/g;

// ============ 核心实现 ============

/**
 * 创建一个新的重映射会话
 */
export function createRemapSession(): RemapSession {
  return {
    placeholderToOriginal: new Map(),
    originalToPlaceholder: new Map(),
    entries: [],
    nextId: 1,
  };
}

/**
 * 判断一个字符串是否为高熵标识符（需要重映射保护）
 *
 * 设计原则：只替换真正高熵的字符串，避免过度替换破坏可读性
 * - URL 含路径/查询参数 → 替换
 * - 纯域名 (e.g. google.com) → 不替换
 * - UUID → 替换
 * - 长 hash → 替换
 * - 短 ID → 不替换
 */
export function classifyHighEntropyString(value: string): RemapEntry["type"] | null {
  // URL with path or query (not just domain)
  if (/^https?:\/\/.+\/.+/.test(value) || /^https?:\/\/.+[?#&=]/.test(value)) {
    return "url";
  }

  // UUID v4
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return "uuid";
  }

  // Git SHA or similar hash (40 hex chars)
  if (/^[0-9a-f]{40}$/i.test(value)) {
    return "hash";
  }

  // Long alphanumeric ID (20+ chars, mostly non-word characters)
  if (value.length >= 24 && /^[a-zA-Z0-9_-]+$/.test(value)) {
    // Check entropy - count unique characters
    const uniqueChars = new Set(value.toLowerCase()).size;
    if (uniqueChars >= 10) {
      return "id";
    }
  }

  return null;
}

/**
 * 从文本中提取所有高熵标识符
 */
export function extractHighEntropyStrings(text: string): Array<{ value: string; type: RemapEntry["type"] }> {
  const results: Array<{ value: string; type: RemapEntry["type"] }> = [];
  const seen = new Set<string>();

  // Extract URLs (highest priority - most commonly hallucinated)
  const urls = text.match(URL_PATTERN) || [];
  for (const url of urls) {
    // Clean trailing punctuation that might be captured
    const cleaned = url.replace(/[.,;:!?)}\]]+$/, "");
    const type = classifyHighEntropyString(cleaned);
    if (type && !seen.has(cleaned)) {
      seen.add(cleaned);
      results.push({ value: cleaned, type });
    }
  }

  // Extract UUIDs
  const uuids = text.match(UUID_PATTERN) || [];
  for (const uuid of uuids) {
    if (!seen.has(uuid)) {
      seen.add(uuid);
      results.push({ value: uuid, type: "uuid" });
    }
  }

  // Extract git hashes
  const hashes = text.match(HASH_PATTERN) || [];
  for (const hash of hashes) {
    if (!seen.has(hash)) {
      seen.add(hash);
      results.push({ value: hash, type: "hash" });
    }
  }

  // Extract long IDs (lower priority - only if clearly high entropy)
  const longIds = text.match(LONG_ID_PATTERN) || [];
  for (const id of longIds) {
    if (!seen.has(id)) {
      const type = classifyHighEntropyString(id);
      if (type) {
        seen.add(id);
        results.push({ value: id, type });
      }
    }
  }

  return results;
}

/**
 * 注册一个值到会话映射中，返回占位符
 *
 * 如果值已经注册，返回已有占位符（幂等）
 */
export function registerValue(session: RemapSession, value: string, type: RemapEntry["type"], source?: string): string {
  // 幂等：已注册则返回已有占位符
  const existing = session.originalToPlaceholder.get(value);
  if (existing) return existing;

  const placeholder = `REF-${session.nextId}`;
  session.nextId++;

  session.placeholderToOriginal.set(placeholder, value);
  session.originalToPlaceholder.set(value, placeholder);
  session.entries.push({ placeholder, original: value, type, source });

  return placeholder;
}

/**
 * Pre-processing: 将 tool_result 内容中的高熵字符串替换为占位符
 *
 * @param content - tool_result 的原始内容
 * @param session - 重映射会话
 * @param toolName - 来源工具名
 * @returns 替换后的内容
 */
export function remapToolResult(content: string, session: RemapSession, toolName?: string): string {
  // 提取所有高熵字符串
  const highEntropyStrings = extractHighEntropyStrings(content);

  if (highEntropyStrings.length === 0) {
    return content;
  }

  let result = content;

  // 按长度降序排列，避免短字符串替换破坏长字符串
  const sorted = [...highEntropyStrings].sort((a, b) => b.value.length - a.value.length);

  for (const { value, type } of sorted) {
    const placeholder = registerValue(session, value, type, toolName);
    // 使用全局替换，确保所有出现都被替换
    result = replaceAll(result, value, placeholder);
  }

  return result;
}

/**
 * Post-processing: 从模型输出中还原占位符为真实值
 *
 * 支持三种还原策略：
 * 1. 精确匹配：模型输出了正确的占位符 → 直接替换
 * 2. 模糊匹配：模型输出了接近但不完全正确的值 → 校正为最近匹配
 * 3. 残留检测：检测模型可能自行生成的看似 URL/UUID 的值 → 标记警告
 */
export function restoreFromPlaceholders(output: string, session: RemapSession): RestoreResult {
  if (session.entries.length === 0) {
    return { content: output, restoredCount: 0, corrections: [] };
  }

  let result = output;
  let restoredCount = 0;
  const corrections: CorrectionEntry[] = [];

  // 1. 精确占位符替换
  result = result.replace(PLACEHOLDER_PATTERN, (match) => {
    const original = session.placeholderToOriginal.get(match);
    if (original) {
      restoredCount++;
      return original;
    }
    return match; // 未知占位符保留原样
  });

  // 2. 模糊匹配校正：检测模型自行生成的近似 URL/UUID
  const outputHighEntropy = extractHighEntropyStrings(result);
  for (const { value, type } of outputHighEntropy) {
    // 如果这个值已经在我们的映射中（原始值），说明它是正确的
    if (session.originalToPlaceholder.has(value)) continue;

    // 尝试找到最接近的已知值
    const bestMatch = findBestMatch(value, session, type);
    if (bestMatch) {
      corrections.push({
        original: value,
        corrected: bestMatch.original,
        confidence: bestMatch.similarity,
        type,
      });
      result = replaceAll(result, value, bestMatch.original);
      restoredCount++;
    }
  }

  return { content: result, restoredCount, corrections };
}

/**
 * 生成映射参考表（注入到系统提示中帮助模型理解占位符含义）
 */
export function generateReferenceTable(session: RemapSession): string {
  if (session.entries.length === 0) return "";

  const lines = session.entries.map(e => {
    const typeLabel = { url: "URL", uuid: "ID", path: "Path", hash: "Hash", id: "ID" }[e.type];
    return `  ${e.placeholder} → [${typeLabel}]${e.source ? ` (from ${e.source})` : ""}`;
  });

  return `\n<reference-map>\nThe following placeholders map to structured identifiers. Use these placeholders in your response; they will be automatically resolved:\n${lines.join("\n")}\n</reference-map>`;
}

// ============ 辅助类型和函数 ============

/** 还原结果 */
export interface RestoreResult {
  /** 还原后的内容 */
  content: string;
  /** 成功还原的占位符数量 */
  restoredCount: number;
  /** 模糊匹配校正记录 */
  corrections: CorrectionEntry[];
}

/** 模糊匹配校正条目 */
export interface CorrectionEntry {
  /** 模型输出的值 */
  original: string;
  /** 校正后的值 */
  corrected: string;
  /** 匹配置信度 (0-1) */
  confidence: number;
  /** 值类型 */
  type: RemapEntry["type"];
}

/**
 * 在已知值中查找最佳模糊匹配
 *
 * 使用编辑距离比率作为相似度度量。
 * 阈值设置为 0.8（即最多允许 20% 的字符差异）
 */
function findBestMatch(
  value: string,
  session: RemapSession,
  type: RemapEntry["type"]
): { original: string; similarity: number } | null {
  const SIMILARITY_THRESHOLD = 0.8;
  let bestMatch: { original: string; similarity: number } | null = null;

  for (const entry of session.entries) {
    // 只与同类型的值比较
    if (entry.type !== type) continue;

    const similarity = calculateSimilarity(value, entry.original);
    if (similarity >= SIMILARITY_THRESHOLD) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { original: entry.original, similarity };
      }
    }
  }

  return bestMatch;
}

/**
 * 计算两个字符串的相似度 (0-1)
 *
 * 使用优化的 Levenshtein 距离比率：
 * similarity = 1 - (editDistance / maxLength)
 *
 * 对于 URL，先比较 domain 部分（必须完全匹配），
 * 再对路径部分计算编辑距离。
 */
export function calculateSimilarity(a: string, b: string): number {
  if (!a && !b) return 0; // 两个空字符串没有语义相似度
  if (a === b) return 1;
  if (!a || !b) return 0;

  // URL 特殊处理：domain 必须匹配
  const urlPatternA = a.match(/^(https?:\/\/[^/]+)(\/.*)?$/);
  const urlPatternB = b.match(/^(https?:\/\/[^/]+)(\/.*)?$/);
  if (urlPatternA && urlPatternB) {
    if (urlPatternA[1] !== urlPatternB[1]) return 0; // domain 不同
    // 只比较路径部分
    const pathA = urlPatternA[2] || "";
    const pathB = urlPatternB[2] || "";
    return 1 - levenshteinDistance(pathA, pathB) / Math.max(pathA.length, pathB.length, 1);
  }

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Levenshtein 编辑距离 - 使用 Wagner-Fischer 算法
 * 空间优化为 O(min(m,n))
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length > b.length) [a, b] = [b, a]; // 确保 a 较短

  const m = a.length;
  const n = b.length;

  // 早期退出优化
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(m + 1);
  let curr = new Array(m + 1);

  for (let i = 0; i <= m; i++) prev[i] = i;

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,     // deletion
        curr[i - 1] + 1, // insertion
        prev[i - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[m];
}

/**
 * 安全的全局字符串替换（不使用正则，避免特殊字符问题）
 */
function replaceAll(str: string, search: string, replacement: string): string {
  if (!search) return str;
  let result = str;
  let index = result.indexOf(search);
  while (index !== -1) {
    result = result.slice(0, index) + replacement + result.slice(index + search.length);
    index = result.indexOf(search, index + replacement.length);
  }
  return result;
}
