/**
 * Post-Processor 单元测试
 *
 * 覆盖：
 * - 输出验证（未解析占位符、可疑 URL/UUID）
 * - 已知值集合构建
 * - 完整后处理管道
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  postProcess,
  validateOutput,
  buildKnownValueSet,
} from "../postProcessor.js";
import {
  createRemapSession,
  registerValue,
  type RemapSession,
} from "../idRemapper.js";

describe("validateOutput", () => {
  let session: RemapSession;

  beforeEach(() => {
    session = createRemapSession();
    registerValue(session, "https://api.example.com/v1/data?key=abc123", "url", "WebSearch");
    registerValue(session, "550e8400-e29b-41d4-a716-446655440000", "uuid", "Read");
  });

  test("合法输出通过验证", () => {
    const content = "The API at https://api.example.com/v1/data?key=abc123 returned user 550e8400-e29b-41d4-a716-446655440000.";
    const result = validateOutput(content, session);

    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBe(0);
  });

  test("检测未解析的占位符", () => {
    const content = "See REF-99 for details.";
    const result = validateOutput(content, session);

    expect(result.valid).toBe(false);
    const unresolvedWarnings = result.warnings.filter(w => w.type === "unresolved_placeholder");
    expect(unresolvedWarnings.length).toBe(1);
    expect(unresolvedWarnings[0].value).toBe("REF-99");
  });

  test("检测可疑的未知 URL（潜在幻觉）", () => {
    const content = "See https://api.example.com/v1/totally-hallucinated-endpoint?fake=true for details.";
    const result = validateOutput(content, session);

    const urlWarnings = result.warnings.filter(w => w.type === "suspicious_url");
    expect(urlWarnings.length).toBeGreaterThan(0);
  });

  test("检测可疑的未知 UUID（潜在幻觉）", () => {
    const content = "User ID is 12345678-1234-1234-1234-123456789012.";
    const result = validateOutput(content, session);

    const uuidWarnings = result.warnings.filter(w => w.type === "suspicious_uuid");
    expect(uuidWarnings.length).toBe(1);
  });

  test("空会话不产生误报", () => {
    const emptySession = createRemapSession();
    const content = "Some text with https://example.com/path/to/page and 550e8400-e29b-41d4-a716-446655440000.";
    const result = validateOutput(content, emptySession);

    // 空会话时不检查高熵字符串（因为没有已知值可比对）
    expect(result.valid).toBe(true);
  });
});

describe("postProcess", () => {
  let session: RemapSession;

  beforeEach(() => {
    session = createRemapSession();
    registerValue(session, "https://api.example.com/v1/search?q=langchain&page=1", "url", "WebSearch");
    registerValue(session, "550e8400-e29b-41d4-a716-446655440000", "uuid", "Read");
    registerValue(session, "abc123def456789012345678901234567890abcd", "hash", "Bash");
  });

  test("完整管道：占位符还原 + 验证", () => {
    const output = "The search results are at REF-1. User REF-2 committed REF-3.";
    const result = postProcess(output, session);

    expect(result.content).toContain("https://api.example.com/v1/search?q=langchain&page=1");
    expect(result.content).toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(result.content).toContain("abc123def456789012345678901234567890abcd");
    expect(result.content).not.toContain("REF-1");
    expect(result.content).not.toContain("REF-2");
    expect(result.content).not.toContain("REF-3");
    expect(result.restore.restoredCount).toBe(3);
    expect(result.validation.valid).toBe(true);
  });

  test("部分占位符 + 部分幻觉 URL", () => {
    const output = "See REF-1 and also https://fake.example.com/hallucinated/path for more.";
    const result = postProcess(output, session);

    expect(result.content).toContain("https://api.example.com/v1/search?q=langchain&page=1");
    expect(result.restore.restoredCount).toBeGreaterThanOrEqual(1);
  });

  test("无映射时直接通过", () => {
    const emptySession = createRemapSession();
    const output = "Normal text without any IDs.";
    const result = postProcess(output, emptySession);

    expect(result.content).toBe(output);
    expect(result.restore.restoredCount).toBe(0);
    expect(result.validation.valid).toBe(true);
  });
});

describe("buildKnownValueSet", () => {
  test("构建已知值集合", () => {
    const session = createRemapSession();
    registerValue(session, "https://api.example.com/v1/data?x=1", "url");
    registerValue(session, "550e8400-e29b-41d4-a716-446655440000", "uuid");

    const known = buildKnownValueSet(session);

    expect(known.size).toBe(2);
    expect(known.has("https://api.example.com/v1/data?x=1")).toBe(true);
    expect(known.has("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  test("空会话返回空集合", () => {
    const session = createRemapSession();
    expect(buildKnownValueSet(session).size).toBe(0);
  });
});
