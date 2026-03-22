/**
 * Message Utilities Tests
 *
 * Covers:
 * - extractTextContent (string, array, complex content)
 * - messagesToText (conversation formatting)
 * - getMessageText helper
 */

import { describe, test, expect } from "bun:test";
import { extractTextContent, messagesToText, getMessageText } from "../messages.js";
import { HumanMessage, AIMessage, ToolMessage, SystemMessage } from "@langchain/core/messages";

describe("extractTextContent", () => {
  test("returns string content as-is", () => {
    expect(extractTextContent("hello world")).toBe("hello world");
  });

  test("returns empty string for empty string", () => {
    expect(extractTextContent("")).toBe("");
  });

  test("extracts text from content array", () => {
    const content = [
      { type: "text", text: "Hello" },
      { type: "text", text: " World" },
    ];
    expect(extractTextContent(content)).toBe("Hello World");
  });

  test("handles mixed string and object array elements", () => {
    const content = ["Hello", { type: "text", text: " World" }];
    expect(extractTextContent(content)).toBe("Hello World");
  });

  test("ignores non-text content blocks", () => {
    const content = [
      { type: "text", text: "Hello" },
      { type: "image", source: "..." },
    ];
    expect(extractTextContent(content)).toBe("Hello");
  });

  test("converts non-string, non-array to string", () => {
    expect(extractTextContent(42)).toBe("42");
    expect(extractTextContent(true)).toBe("true");
    expect(extractTextContent(null)).toBe("null");
  });

  test("handles empty array", () => {
    expect(extractTextContent([])).toBe("");
  });

  test("handles deeply nested objects without text field", () => {
    const content = [{ type: "image", data: "base64..." }];
    expect(extractTextContent(content)).toBe("");
  });
});

describe("messagesToText", () => {
  test("formats human message", () => {
    const messages = [new HumanMessage("What is TypeScript?")];
    const text = messagesToText(messages);
    expect(text).toContain("User: What is TypeScript?");
  });

  test("formats AI message", () => {
    const messages = [new AIMessage("TypeScript is a typed superset of JavaScript")];
    const text = messagesToText(messages);
    expect(text).toContain("Assistant: TypeScript is a typed superset of JavaScript");
  });

  test("formats AI message with tool calls", () => {
    const messages = [
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "1", name: "Read", args: { file_path: "test.ts" } },
          { id: "2", name: "Grep", args: { pattern: "function" } },
        ],
      }),
    ];
    const text = messagesToText(messages);
    expect(text).toContain("Tool calls: Read, Grep");
  });

  test("formats tool result message", () => {
    const messages = [
      new ToolMessage({ content: "file contents here", tool_call_id: "1", name: "Read" }),
    ];
    const text = messagesToText(messages);
    expect(text).toContain("Tool[Read] result: file contents here");
  });

  test("truncates long tool results at default 500 chars", () => {
    const longContent = "x".repeat(1000);
    const messages = [
      new ToolMessage({ content: longContent, tool_call_id: "1", name: "Read" }),
    ];
    const text = messagesToText(messages);
    expect(text).toContain("...");
    expect(text.length).toBeLessThan(1200); // 500 + label + "..."
  });

  test("custom maxToolResultLength", () => {
    const content = "x".repeat(200);
    const messages = [
      new ToolMessage({ content, tool_call_id: "1", name: "Read" }),
    ];
    const text = messagesToText(messages, 100);
    expect(text).toContain("...");
    // Short content should be truncated at 100
  });

  test("does not truncate short tool results", () => {
    const messages = [
      new ToolMessage({ content: "short result", tool_call_id: "1", name: "Read" }),
    ];
    const text = messagesToText(messages);
    expect(text).not.toContain("...");
    expect(text).toContain("short result");
  });

  test("formats multi-turn conversation", () => {
    const messages = [
      new HumanMessage("Hello"),
      new AIMessage("Hi! How can I help?"),
      new HumanMessage("Read my file"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "1", name: "Read", args: { file_path: "test.ts" } }],
      }),
      new ToolMessage({ content: "export const x = 1;", tool_call_id: "1", name: "Read" }),
      new AIMessage("Here is your file content."),
    ];
    const text = messagesToText(messages);

    expect(text).toContain("User: Hello");
    expect(text).toContain("Assistant: Hi! How can I help?");
    expect(text).toContain("User: Read my file");
    expect(text).toContain("Tool calls: Read");
    expect(text).toContain("Tool[Read] result: export const x = 1;");
    expect(text).toContain("Assistant: Here is your file content.");
  });

  test("skips system messages", () => {
    const messages = [
      new SystemMessage("You are a helpful assistant"),
      new HumanMessage("Hello"),
    ];
    const text = messagesToText(messages);
    expect(text).not.toContain("helpful assistant");
    expect(text).toContain("User: Hello");
  });

  test("handles empty array", () => {
    const text = messagesToText([]);
    expect(text).toBe("");
  });

  test("handles non-string content in messages", () => {
    const msg = new HumanMessage({
      content: [{ type: "text", text: "Hello from array" }],
    });
    const text = messagesToText([msg]);
    expect(text).toContain("Hello from array");
  });
});

describe("getMessageText", () => {
  test("extracts text from string content", () => {
    const msg = new HumanMessage("Hello");
    expect(getMessageText(msg)).toBe("Hello");
  });

  test("extracts text from array content", () => {
    const msg = new HumanMessage({
      content: [{ type: "text", text: "Hello World" }],
    });
    expect(getMessageText(msg)).toBe("Hello World");
  });

  test("works with AI messages", () => {
    const msg = new AIMessage("Response text");
    expect(getMessageText(msg)).toBe("Response text");
  });
});
