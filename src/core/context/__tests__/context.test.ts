/**
 * Context Injection Tests
 *
 * Covers:
 * - CLAUDE.md / AGENT.md context generation
 * - Todo context generation
 * - Context collection and formatting
 * - Tool result wrapping
 * - Priority ordering
 */

import { describe, test, expect } from "bun:test";
import {
  generateTodoContext,
  collectContextItems,
  formatContextAsReminder,
  wrapToolResult,
  generateTodoWriteHint,
} from "../index.js";
import { setTodos, clearTodos } from "../../tools/todo.js";

describe("generateTodoContext", () => {
  test("returns null when no todos", () => {
    clearTodos();
    const context = generateTodoContext();
    expect(context).toBeNull();
  });

  test("returns context when todos exist", () => {
    setTodos([{ content: "Fix bug", status: "in_progress", activeForm: "Fixing bug" }]);
    const context = generateTodoContext();
    expect(context).not.toBeNull();
    expect(context).toContain("todo list");
    expect(context).toContain("Fix bug");
    clearTodos();
  });

  test("includes todo status", () => {
    setTodos([
      { content: "Task 1", status: "completed", activeForm: "Task 1" },
      { content: "Task 2", status: "pending", activeForm: "Task 2" },
    ]);
    const context = generateTodoContext();
    expect(context).toContain("completed");
    expect(context).toContain("pending");
    clearTodos();
  });
});

describe("collectContextItems", () => {
  test("returns items sorted by priority", () => {
    const items = collectContextItems();
    // Verify sorting: each item's priority >= next item's priority
    for (let i = 0; i < items.length - 1; i++) {
      expect(items[i].priority).toBeGreaterThanOrEqual(items[i + 1].priority);
    }
  });

  test("items have required fields", () => {
    const items = collectContextItems();
    for (const item of items) {
      expect(typeof item.type).toBe("string");
      expect(typeof item.content).toBe("string");
      expect(typeof item.priority).toBe("number");
    }
  });

  test("includes todo context when todos exist", () => {
    setTodos([{ content: "Important task", status: "in_progress", activeForm: "Working on task" }]);
    const items = collectContextItems();
    const todoItem = items.find(i => i.type === "todoReminder");
    expect(todoItem).toBeDefined();
    expect(todoItem!.content).toContain("Important task");
    clearTodos();
  });
});

describe("formatContextAsReminder", () => {
  test("returns empty string for empty items", () => {
    expect(formatContextAsReminder([])).toBe("");
  });

  test("wraps content in system-reminder tags", () => {
    const items = [
      { type: "custom" as const, content: "Test content", priority: 50 },
    ];
    const formatted = formatContextAsReminder(items);
    expect(formatted).toContain("<system-reminder>");
    expect(formatted).toContain("</system-reminder>");
    expect(formatted).toContain("Test content");
  });

  test("includes multiple items", () => {
    const items = [
      { type: "custom" as const, content: "First", priority: 100 },
      { type: "custom" as const, content: "Second", priority: 50 },
    ];
    const formatted = formatContextAsReminder(items);
    expect(formatted).toContain("First");
    expect(formatted).toContain("Second");
  });
});

describe("wrapToolResult", () => {
  test("adds malware reminder for Read tool", () => {
    const result = wrapToolResult("Read", "file contents");
    expect(result).toContain("file contents");
    expect(result).toContain("malware");
  });

  test("returns plain result for non-special tools", () => {
    const result = wrapToolResult("Glob", "file list");
    expect(result).toBe("file list");
  });

  test("adds todo context for TodoWrite", () => {
    setTodos([{ content: "Track this", status: "pending", activeForm: "Tracking" }]);
    const result = wrapToolResult("TodoWrite", "todos updated");
    expect(result).toContain("todos updated");
    expect(result).toContain("todo list");
    clearTodos();
  });

  test("no extra wrapping for TodoWrite when no todos", () => {
    clearTodos();
    const result = wrapToolResult("TodoWrite", "todos updated");
    expect(result).toBe("todos updated");
  });
});

describe("generateTodoWriteHint", () => {
  test("returns a non-empty hint string", () => {
    const hint = generateTodoWriteHint();
    expect(typeof hint).toBe("string");
    expect(hint.length).toBeGreaterThan(0);
    expect(hint).toContain("TodoWrite");
  });
});
