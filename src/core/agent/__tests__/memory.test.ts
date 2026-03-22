/**
 * Memory Management Tests
 *
 * Covers:
 * - Token estimation (Chinese, English, mixed)
 * - Message token counting
 * - Compression prompt building
 * - Context usage calculation
 * - Edge cases (empty inputs, large messages)
 */

import { describe, test, expect } from "bun:test";
import {
  estimateTokens,
  countMessageTokens,
  buildComprehensiveSummaryPrompt,
  getContextUsage,
  COMPRESSION_PROMPT,
  MEMORY_CONSTANTS,
} from "../memory.js";
import { HumanMessage, AIMessage, ToolMessage, SystemMessage } from "@langchain/core/messages";

describe("estimateTokens", () => {
  test("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("returns 0 for null/undefined", () => {
    expect(estimateTokens(null as any)).toBe(0);
    expect(estimateTokens(undefined as any)).toBe(0);
  });

  test("estimates English text (~4 chars/token)", () => {
    const text = "Hello, World!"; // 13 chars → ~4 tokens
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(text.length); // Should be less than char count
  });

  test("estimates Chinese text (~1.5 chars/token)", () => {
    const text = "你好世界"; // 4 chars → ~3 tokens
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThanOrEqual(4); // ~1.5 chars/token means ~3 tokens
  });

  test("handles mixed Chinese and English", () => {
    const text = "Hello 你好 World 世界";
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    // Should be between pure English and pure Chinese estimates
    const pureEnglish = estimateTokens("Hello  World ");
    const pureChinese = estimateTokens("你好世界");
    expect(tokens).toBeGreaterThanOrEqual(Math.min(pureEnglish, pureChinese));
  });

  test("handles code content", () => {
    const code = `function hello() { console.log("world"); }`;
    const tokens = estimateTokens(code);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(code.length);
  });

  test("handles large text", () => {
    const largeText = "a".repeat(100000);
    const tokens = estimateTokens(largeText);
    expect(tokens).toBe(Math.ceil(100000 / 4));
  });
});

describe("countMessageTokens", () => {
  test("returns 0 for empty array", () => {
    expect(countMessageTokens([])).toBe(0);
  });

  test("counts single human message", () => {
    const messages = [new HumanMessage("Hello, world!")];
    const tokens = countMessageTokens(messages);
    // Should include overhead (4) + content tokens
    expect(tokens).toBeGreaterThan(4);
  });

  test("counts multiple messages", () => {
    const messages = [
      new HumanMessage("Hello"),
      new AIMessage("Hi there!"),
    ];
    const singleTokens = countMessageTokens([messages[0]]);
    const bothTokens = countMessageTokens(messages);
    expect(bothTokens).toBeGreaterThan(singleTokens);
  });

  test("counts tool call tokens", () => {
    const withoutToolCalls = new AIMessage("Let me help");
    const withToolCalls = new AIMessage({
      content: "Let me help",
      tool_calls: [
        { id: "call_1", name: "Read", args: { file_path: "/some/file.ts" } },
      ],
    });

    const tokensWithout = countMessageTokens([withoutToolCalls]);
    const tokensWith = countMessageTokens([withToolCalls]);
    expect(tokensWith).toBeGreaterThan(tokensWithout);
  });

  test("counts tool result messages", () => {
    const toolMsg = new ToolMessage({
      content: "File contents here...",
      tool_call_id: "call_1",
      name: "Read",
    });
    const tokens = countMessageTokens([toolMsg]);
    expect(tokens).toBeGreaterThan(4); // overhead + content
  });

  test("handles messages with non-string content", () => {
    const msg = new HumanMessage({
      content: [
        { type: "text", text: "Hello" },
        { type: "text", text: "World" },
      ],
    });
    const tokens = countMessageTokens([msg]);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("buildComprehensiveSummaryPrompt", () => {
  test("includes compression prompt sections", () => {
    const messages = [
      new HumanMessage("Fix the bug"),
      new AIMessage("I'll look at it"),
    ];
    const prompt = buildComprehensiveSummaryPrompt(messages);

    expect(prompt).toContain("Technical Context");
    expect(prompt).toContain("Project Overview");
    expect(prompt).toContain("Code Changes");
    expect(prompt).toContain("Current Status");
    expect(prompt).toContain("Pending Tasks");
    expect(prompt).toContain("Key Decisions");
  });

  test("includes conversation content", () => {
    const messages = [
      new HumanMessage("Fix the authentication bug"),
      new AIMessage("I found the issue in auth.ts"),
    ];
    const prompt = buildComprehensiveSummaryPrompt(messages);

    expect(prompt).toContain("Fix the authentication bug");
    expect(prompt).toContain("I found the issue in auth.ts");
  });

  test("includes tool call information", () => {
    const messages = [
      new HumanMessage("Read the file"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "1", name: "Read", args: { file_path: "test.ts" } }],
      }),
      new ToolMessage({ content: "file contents...", tool_call_id: "1", name: "Read" }),
    ];
    const prompt = buildComprehensiveSummaryPrompt(messages);

    expect(prompt).toContain("Read");
    expect(prompt).toContain("file contents...");
  });

  test("handles empty messages", () => {
    const prompt = buildComprehensiveSummaryPrompt([]);
    expect(prompt).toContain("Technical Context"); // Still includes template
  });

  test("truncates long tool results", () => {
    const longContent = "x".repeat(1000);
    const messages = [
      new ToolMessage({ content: longContent, tool_call_id: "1", name: "Read" }),
    ];
    const prompt = buildComprehensiveSummaryPrompt(messages);
    // Default truncation is 500 chars
    expect(prompt.length).toBeLessThan(COMPRESSION_PROMPT.length + 1000 + 200);
  });
});

describe("COMPRESSION_PROMPT", () => {
  test("is a non-empty string", () => {
    expect(typeof COMPRESSION_PROMPT).toBe("string");
    expect(COMPRESSION_PROMPT.length).toBeGreaterThan(100);
  });

  test("contains all 8 sections", () => {
    const sections = [
      "Technical Context",
      "Project Overview",
      "Code Changes",
      "Debugging & Issues",
      "Current Status",
      "Pending Tasks",
      "User Preferences",
      "Key Decisions",
    ];
    for (const section of sections) {
      expect(COMPRESSION_PROMPT).toContain(section);
    }
  });
});

describe("getContextUsage", () => {
  test("calculates basic usage", () => {
    const messages = [
      new HumanMessage("Hello"),
      new AIMessage("Hi!"),
    ];

    const usage = getContextUsage(messages, "test-model");
    expect(usage.tokenCount).toBeGreaterThan(0);
    expect(usage.contextLimit).toBeGreaterThan(0);
    expect(usage.percentUsed).toBeGreaterThanOrEqual(0);
    expect(usage.percentUsed).toBeLessThanOrEqual(100);
    expect(typeof usage.isAboveAutoCompactThreshold).toBe("boolean");
    expect(usage.tokensRemaining).toBeGreaterThanOrEqual(0);
  });

  test("small messages are below threshold", () => {
    const messages = [new HumanMessage("Hi")];
    const usage = getContextUsage(messages, "test-model");
    expect(usage.isAboveAutoCompactThreshold).toBe(false);
    expect(usage.tokensRemaining).toBeGreaterThan(0);
  });

  test("returns correct percent calculation", () => {
    const messages = [new HumanMessage("x".repeat(100))];
    const usage = getContextUsage(messages, "test-model");
    // Percent should be token/limit * 100 rounded
    const expectedPercent = Math.round((usage.tokenCount / usage.contextLimit) * 100);
    expect(usage.percentUsed).toBe(expectedPercent);
  });
});

describe("MEMORY_CONSTANTS", () => {
  test("AUTO_COMPACT_THRESHOLD is 0.92", () => {
    expect(MEMORY_CONSTANTS.AUTO_COMPACT_THRESHOLD).toBe(0.92);
  });

  test("MESSAGE_OVERHEAD_TOKENS is defined", () => {
    expect(MEMORY_CONSTANTS.MESSAGE_OVERHEAD_TOKENS).toBe(4);
  });

  test("TOOL_CALL_OVERHEAD_TOKENS is defined", () => {
    expect(MEMORY_CONSTANTS.TOOL_CALL_OVERHEAD_TOKENS).toBe(10);
  });
});
