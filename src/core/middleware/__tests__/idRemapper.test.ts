/**
 * ID Remapper 单元测试
 *
 * 覆盖：
 * - 高熵字符串分类
 * - URL/UUID/Hash/ID 提取
 * - 占位符注册与替换
 * - 占位符还原
 * - 模糊匹配校正
 * - 相似度计算
 * - 边界情况
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  createRemapSession,
  classifyHighEntropyString,
  extractHighEntropyStrings,
  registerValue,
  remapToolResult,
  restoreFromPlaceholders,
  generateReferenceTable,
  calculateSimilarity,
  type RemapSession,
} from "../idRemapper.js";

// ============ classifyHighEntropyString ============

describe("classifyHighEntropyString", () => {
  test("识别带路径的 URL", () => {
    expect(classifyHighEntropyString("https://example.com/api/v1/users")).toBe("url");
    expect(classifyHighEntropyString("https://cdn.example.com/assets/img/logo.png")).toBe("url");
    expect(classifyHighEntropyString("http://localhost:3000/api/data?key=abc123&format=json")).toBe("url");
  });

  test("识别带查询参数的 URL", () => {
    expect(classifyHighEntropyString("https://example.com?token=abc123")).toBe("url");
    expect(classifyHighEntropyString("https://s3.amazonaws.com/bucket/file?X-Amz-Signature=abc123def456")).toBe("url");
  });

  test("不替换纯域名 URL", () => {
    expect(classifyHighEntropyString("https://example.com")).toBeNull();
    expect(classifyHighEntropyString("https://google.com")).toBeNull();
  });

  test("识别 UUID v4", () => {
    expect(classifyHighEntropyString("550e8400-e29b-41d4-a716-446655440000")).toBe("uuid");
    expect(classifyHighEntropyString("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("uuid");
  });

  test("识别 Git SHA", () => {
    expect(classifyHighEntropyString("a".repeat(40))).toBe("hash");
    expect(classifyHighEntropyString("abc123def456789012345678901234567890abcd")).toBe("hash");
  });

  test("识别长高熵 ID", () => {
    // Base64-like token with sufficient entropy
    expect(classifyHighEntropyString("sk-proj-abc123def456ghi789jkl012mno")).toBe("id");
  });

  test("不替换短字符串", () => {
    expect(classifyHighEntropyString("hello")).toBeNull();
    expect(classifyHighEntropyString("user-123")).toBeNull();
    expect(classifyHighEntropyString("12345")).toBeNull();
  });

  test("不替换低熵长字符串", () => {
    // Repetitive patterns - low unique char count
    expect(classifyHighEntropyString("aaaaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
  });
});

// ============ extractHighEntropyStrings ============

describe("extractHighEntropyStrings", () => {
  test("从文本中提取 URL", () => {
    const text = `
      Results found at https://api.example.com/v1/search?q=test&page=1
      Also see: https://docs.example.com/guide/getting-started
    `;
    const results = extractHighEntropyStrings(text);
    expect(results.length).toBe(2);
    expect(results.every(r => r.type === "url")).toBe(true);
  });

  test("从文本中提取 UUID", () => {
    const text = `
      User ID: 550e8400-e29b-41d4-a716-446655440000
      Session: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
    `;
    const results = extractHighEntropyStrings(text);
    expect(results.length).toBe(2);
    expect(results.every(r => r.type === "uuid")).toBe(true);
  });

  test("去重相同值", () => {
    const text = `
      ID: 550e8400-e29b-41d4-a716-446655440000
      Same ID: 550e8400-e29b-41d4-a716-446655440000
    `;
    const results = extractHighEntropyStrings(text);
    expect(results.length).toBe(1);
  });

  test("混合提取多种类型", () => {
    const text = `
      URL: https://api.example.com/v1/data?key=secret123
      UUID: 550e8400-e29b-41d4-a716-446655440000
      Hash: ${"a1b2c3d4e5".repeat(4)}
    `;
    const results = extractHighEntropyStrings(text);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test("空文本返回空数组", () => {
    expect(extractHighEntropyStrings("")).toEqual([]);
    expect(extractHighEntropyStrings("Hello world")).toEqual([]);
  });

  test("清理 URL 尾部标点", () => {
    const text = 'Visit https://example.com/path/to/page, then continue.';
    const results = extractHighEntropyStrings(text);
    if (results.length > 0) {
      expect(results[0].value).not.toMatch(/[,.]$/);
    }
  });
});

// ============ createRemapSession & registerValue ============

describe("RemapSession", () => {
  let session: RemapSession;

  beforeEach(() => {
    session = createRemapSession();
  });

  test("创建空会话", () => {
    expect(session.entries.length).toBe(0);
    expect(session.nextId).toBe(1);
    expect(session.placeholderToOriginal.size).toBe(0);
    expect(session.originalToPlaceholder.size).toBe(0);
  });

  test("注册值返回递增占位符", () => {
    const p1 = registerValue(session, "https://api.example.com/v1/users", "url");
    const p2 = registerValue(session, "550e8400-e29b-41d4-a716-446655440000", "uuid");
    const p3 = registerValue(session, "abc123".repeat(7), "id");

    expect(p1).toBe("REF-1");
    expect(p2).toBe("REF-2");
    expect(p3).toBe("REF-3");
    expect(session.entries.length).toBe(3);
  });

  test("重复注册返回相同占位符（幂等）", () => {
    const url = "https://api.example.com/v1/users";
    const p1 = registerValue(session, url, "url");
    const p2 = registerValue(session, url, "url");

    expect(p1).toBe(p2);
    expect(session.entries.length).toBe(1);
  });

  test("双向映射一致性", () => {
    const url = "https://api.example.com/v1/users";
    const placeholder = registerValue(session, url, "url");

    expect(session.placeholderToOriginal.get(placeholder)).toBe(url);
    expect(session.originalToPlaceholder.get(url)).toBe(placeholder);
  });

  test("source 信息记录", () => {
    registerValue(session, "https://api.example.com/v1", "url", "WebFetch");
    expect(session.entries[0].source).toBe("WebFetch");
  });
});

// ============ remapToolResult ============

describe("remapToolResult", () => {
  let session: RemapSession;

  beforeEach(() => {
    session = createRemapSession();
  });

  test("替换 URL 为占位符", () => {
    const content = 'Found result at https://api.example.com/v1/search?q=test&page=1 with data.';
    const result = remapToolResult(content, session, "WebSearch");

    expect(result).toContain("REF-1");
    expect(result).not.toContain("https://api.example.com/v1/search");
    expect(result).toContain("Found result at");
    expect(result).toContain("with data.");
  });

  test("替换多个 UUID", () => {
    const content = `
      User: 550e8400-e29b-41d4-a716-446655440000
      Session: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
    `;
    const result = remapToolResult(content, session, "Read");

    expect(result).toContain("REF-");
    expect(result).not.toContain("550e8400");
    expect(result).not.toContain("6ba7b810");
    expect(session.entries.length).toBe(2);
  });

  test("相同值在多处出现只注册一次", () => {
    const url = "https://api.example.com/v1/data?key=abc";
    const content = `First: ${url}\nSecond: ${url}\nThird: ${url}`;
    const result = remapToolResult(content, session, "WebFetch");

    expect(session.entries.length).toBe(1);
    // 所有出现都被替换
    const placeholderCount = (result.match(/REF-1/g) || []).length;
    expect(placeholderCount).toBe(3);
  });

  test("无高熵内容不做任何修改", () => {
    const content = "This is a normal text with no URLs or UUIDs.";
    const result = remapToolResult(content, session);

    expect(result).toBe(content);
    expect(session.entries.length).toBe(0);
  });

  test("跨多次调用的会话累积", () => {
    remapToolResult("URL: https://api.example.com/v1/a?x=1", session, "WebSearch");
    remapToolResult("UUID: 550e8400-e29b-41d4-a716-446655440000", session, "Read");

    expect(session.entries.length).toBe(2);
    expect(session.nextId).toBe(3);
  });

  test("JSON 格式内容中的 URL 替换", () => {
    const content = JSON.stringify({
      results: [
        { title: "Result 1", url: "https://example.com/api/v1/result1?id=abc123" },
        { title: "Result 2", url: "https://example.com/api/v1/result2?id=def456" },
      ],
    });
    const result = remapToolResult(content, session);

    expect(result).toContain("REF-1");
    expect(result).toContain("REF-2");
    expect(result).not.toContain("result1?id=abc123");
    expect(result).not.toContain("result2?id=def456");
  });
});

// ============ restoreFromPlaceholders ============

describe("restoreFromPlaceholders", () => {
  let session: RemapSession;

  beforeEach(() => {
    session = createRemapSession();
    registerValue(session, "https://api.example.com/v1/users?page=1", "url", "WebSearch");
    registerValue(session, "550e8400-e29b-41d4-a716-446655440000", "uuid", "Read");
  });

  test("精确还原占位符", () => {
    const output = "The API is at REF-1 and the user ID is REF-2.";
    const result = restoreFromPlaceholders(output, session);

    expect(result.content).toContain("https://api.example.com/v1/users?page=1");
    expect(result.content).toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(result.content).not.toContain("REF-1");
    expect(result.content).not.toContain("REF-2");
    expect(result.restoredCount).toBe(2);
  });

  test("未知占位符保留原样", () => {
    const output = "See REF-1 and REF-99.";
    const result = restoreFromPlaceholders(output, session);

    expect(result.content).toContain("https://api.example.com/v1/users?page=1");
    expect(result.content).toContain("REF-99");
    expect(result.restoredCount).toBe(1);
  });

  test("空会话不做处理", () => {
    const emptySession = createRemapSession();
    const output = "Some text with REF-1.";
    const result = restoreFromPlaceholders(output, emptySession);

    expect(result.content).toBe(output);
    expect(result.restoredCount).toBe(0);
  });

  test("多次出现同一占位符全部还原", () => {
    const output = "First REF-1, then REF-1 again, and REF-1 once more.";
    const result = restoreFromPlaceholders(output, session);

    const urlCount = (result.content.match(/https:\/\/api\.example\.com/g) || []).length;
    expect(urlCount).toBe(3);
    expect(result.restoredCount).toBe(3);
  });

  test("模糊匹配校正被篡改的 URL", () => {
    // 模拟 LLM 输出一个被轻微篡改的 URL（改了 page 参数）
    const output = "See https://api.example.com/v1/users?page=2 for details.";
    const result = restoreFromPlaceholders(output, session);

    // 应该被校正为原始 URL
    expect(result.corrections.length).toBe(1);
    expect(result.corrections[0].corrected).toBe("https://api.example.com/v1/users?page=1");
    expect(result.content).toContain("https://api.example.com/v1/users?page=1");
  });
});

// ============ generateReferenceTable ============

describe("generateReferenceTable", () => {
  test("空会话返回空字符串", () => {
    const session = createRemapSession();
    expect(generateReferenceTable(session)).toBe("");
  });

  test("生成格式正确的参考表", () => {
    const session = createRemapSession();
    registerValue(session, "https://api.example.com/v1/data?q=test", "url", "WebSearch");
    registerValue(session, "550e8400-e29b-41d4-a716-446655440000", "uuid", "Read");

    const table = generateReferenceTable(session);

    expect(table).toContain("<reference-map>");
    expect(table).toContain("REF-1");
    expect(table).toContain("REF-2");
    expect(table).toContain("[URL]");
    expect(table).toContain("[ID]");
    expect(table).toContain("(from WebSearch)");
    expect(table).toContain("(from Read)");
    expect(table).toContain("</reference-map>");
  });
});

// ============ calculateSimilarity ============

describe("calculateSimilarity", () => {
  test("相同字符串相似度为 1", () => {
    expect(calculateSimilarity("hello", "hello")).toBe(1);
  });

  test("完全不同的字符串相似度低", () => {
    expect(calculateSimilarity("abc", "xyz")).toBeLessThan(0.5);
  });

  test("相似 URL 具有高相似度", () => {
    const sim = calculateSimilarity(
      "https://api.example.com/v1/users?page=1",
      "https://api.example.com/v1/users?page=2"
    );
    expect(sim).toBeGreaterThan(0.9);
  });

  test("不同域名的 URL 相似度为 0", () => {
    const sim = calculateSimilarity(
      "https://api.example.com/v1/users",
      "https://api.different.com/v1/users"
    );
    expect(sim).toBe(0);
  });

  test("空字符串处理", () => {
    expect(calculateSimilarity("", "")).toBe(0);
    expect(calculateSimilarity("abc", "")).toBe(0);
    expect(calculateSimilarity("", "abc")).toBe(0);
  });

  test("UUID 单字符差异有高相似度", () => {
    const sim = calculateSimilarity(
      "550e8400-e29b-41d4-a716-446655440000",
      "550e8400-e29b-41d4-a716-446655440001"
    );
    expect(sim).toBeGreaterThan(0.95);
  });
});
