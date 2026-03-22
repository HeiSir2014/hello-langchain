/**
 * Tool Types & Metadata Tests
 *
 * Covers:
 * - Tool metadata registry completeness
 * - Metadata field values
 * - Helper functions (isReadOnly, needsPermission, etc.)
 * - Tool description generation
 * - Concurrency checks
 * - Sensitive tool detection
 */

import { describe, test, expect } from "bun:test";
import {
  TOOL_METADATA,
  SENSITIVE_TOOLS,
  MAX_TOOL_CONCURRENCY,
  getToolMetadata,
  getToolDescriptions,
  isReadOnlyTool,
  isConcurrencySafeTool,
  needsPermission,
  canRunToolsConcurrently,
} from "../types.js";

describe("TOOL_METADATA", () => {
  test("contains all expected tools", () => {
    const expectedTools = [
      "Read", "Write", "Edit", "LS", "Glob", "Grep",
      "Bash", "BashOutput", "KillShell",
      "WebSearch", "WebFetch",
      "TodoWrite",
      "Location", "Weather",
      "MemorySave", "MemorySearch",
      "ExitPlanMode", "SavePlan", "ReadPlan",
    ];

    for (const tool of expectedTools) {
      expect(TOOL_METADATA[tool]).toBeDefined();
    }
  });

  test("every tool has a description", () => {
    for (const [name, meta] of Object.entries(TOOL_METADATA)) {
      expect(meta.description).toBeTruthy();
      expect(meta.description.length).toBeGreaterThan(3);
    }
  });

  test("every tool has a valid category", () => {
    const validCategories = ["file", "bash", "search", "task", "plan", "memory", "other"];
    for (const [name, meta] of Object.entries(TOOL_METADATA)) {
      expect(validCategories).toContain(meta.category);
    }
  });

  test("read-only tools are marked correctly", () => {
    const readOnlyTools = ["Read", "LS", "Glob", "Grep", "BashOutput", "WebSearch", "WebFetch", "Location", "Weather", "MemorySearch", "ReadPlan"];
    for (const tool of readOnlyTools) {
      expect(TOOL_METADATA[tool].isReadOnly).toBe(true);
    }
  });

  test("write tools are not read-only", () => {
    const writeTools = ["Write", "Edit", "Bash", "KillShell", "TodoWrite", "MemorySave", "ExitPlanMode", "SavePlan"];
    for (const tool of writeTools) {
      expect(TOOL_METADATA[tool].isReadOnly).toBe(false);
    }
  });

  test("permission-required tools are correct", () => {
    const permissionTools = ["Bash", "Write", "Edit"];
    for (const tool of permissionTools) {
      expect(TOOL_METADATA[tool].needsPermission).toBe(true);
    }
  });

  test("non-permission tools are correct", () => {
    const noPermissionTools = ["Read", "Glob", "Grep", "LS", "TodoWrite", "WebSearch", "WebFetch"];
    for (const tool of noPermissionTools) {
      expect(TOOL_METADATA[tool].needsPermission).toBe(false);
    }
  });
});

describe("getToolMetadata", () => {
  test("returns metadata for known tool", () => {
    const meta = getToolMetadata("Read");
    expect(meta.isReadOnly).toBe(true);
    expect(meta.category).toBe("file");
    expect(meta.description).toContain("Read");
  });

  test("returns restrictive defaults for unknown tool", () => {
    const meta = getToolMetadata("UnknownTool");
    expect(meta.isReadOnly).toBe(false);
    expect(meta.isConcurrencySafe).toBe(false);
    expect(meta.needsPermission).toBe(true);
    expect(meta.category).toBe("other");
  });
});

describe("getToolDescriptions", () => {
  test("returns descriptions for all tools", () => {
    const descriptions = getToolDescriptions();
    expect(descriptions.length).toBe(Object.keys(TOOL_METADATA).length);
  });

  test("each description has name, description, readOnly", () => {
    const descriptions = getToolDescriptions();
    for (const desc of descriptions) {
      expect(typeof desc.name).toBe("string");
      expect(typeof desc.description).toBe("string");
      expect(typeof desc.readOnly).toBe("boolean");
    }
  });

  test("planModeOnly is set for ExitPlanMode", () => {
    const descriptions = getToolDescriptions();
    const exitPlan = descriptions.find(d => d.name === "ExitPlanMode");
    expect(exitPlan?.planModeOnly).toBe(true);
  });

  test("planModeOnly is not set for regular tools", () => {
    const descriptions = getToolDescriptions();
    const read = descriptions.find(d => d.name === "Read");
    expect(read?.planModeOnly).toBeUndefined();
  });

  test("descriptions match TOOL_METADATA", () => {
    const descriptions = getToolDescriptions();
    for (const desc of descriptions) {
      const meta = TOOL_METADATA[desc.name];
      expect(desc.description).toBe(meta.description);
      expect(desc.readOnly).toBe(meta.isReadOnly);
    }
  });
});

describe("isReadOnlyTool", () => {
  test("Read is read-only", () => {
    expect(isReadOnlyTool("Read")).toBe(true);
  });

  test("Write is not read-only", () => {
    expect(isReadOnlyTool("Write")).toBe(false);
  });

  test("Bash is not read-only", () => {
    expect(isReadOnlyTool("Bash")).toBe(false);
  });

  test("unknown tool defaults to not read-only", () => {
    expect(isReadOnlyTool("SomeNewTool")).toBe(false);
  });
});

describe("isConcurrencySafeTool", () => {
  test("read-only tools are concurrency safe", () => {
    expect(isConcurrencySafeTool("Read")).toBe(true);
    expect(isConcurrencySafeTool("Glob")).toBe(true);
    expect(isConcurrencySafeTool("Grep")).toBe(true);
  });

  test("TodoWrite is concurrency safe", () => {
    expect(isConcurrencySafeTool("TodoWrite")).toBe(true);
  });

  test("Write is not concurrency safe", () => {
    expect(isConcurrencySafeTool("Write")).toBe(false);
  });
});

describe("needsPermission", () => {
  test("Bash needs permission", () => {
    expect(needsPermission("Bash")).toBe(true);
  });

  test("Write needs permission", () => {
    expect(needsPermission("Write")).toBe(true);
  });

  test("Read does not need permission", () => {
    expect(needsPermission("Read")).toBe(false);
  });
});

describe("canRunToolsConcurrently", () => {
  test("all read-only tools can run concurrently", () => {
    expect(canRunToolsConcurrently(["Read", "Glob", "Grep"])).toBe(true);
  });

  test("mix of read and write tools cannot", () => {
    expect(canRunToolsConcurrently(["Read", "Write"])).toBe(false);
  });

  test("empty list returns true", () => {
    expect(canRunToolsConcurrently([])).toBe(true);
  });

  test("single write tool returns false", () => {
    expect(canRunToolsConcurrently(["Bash"])).toBe(false);
  });
});

describe("SENSITIVE_TOOLS", () => {
  test("contains Bash, Write, Edit", () => {
    expect(SENSITIVE_TOOLS).toContain("Bash");
    expect(SENSITIVE_TOOLS).toContain("Write");
    expect(SENSITIVE_TOOLS).toContain("Edit");
  });

  test("does not contain read-only tools", () => {
    expect(SENSITIVE_TOOLS).not.toContain("Read");
    expect(SENSITIVE_TOOLS).not.toContain("Glob");
    expect(SENSITIVE_TOOLS).not.toContain("WebSearch");
  });
});

describe("MAX_TOOL_CONCURRENCY", () => {
  test("is a positive number", () => {
    expect(MAX_TOOL_CONCURRENCY).toBeGreaterThan(0);
    expect(MAX_TOOL_CONCURRENCY).toBe(10);
  });
});
