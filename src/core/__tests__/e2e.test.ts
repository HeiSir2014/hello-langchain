/**
 * End-to-End Integration Tests
 *
 * Tests cross-module integration without requiring an actual LLM.
 * Verifies that modules work together correctly:
 * - Memory + Events integration
 * - Tool metadata + tool filtering
 * - Context injection pipeline
 * - Skill + tool integration
 * - Compression prompt flow
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { HumanMessage, AIMessage, ToolMessage, SystemMessage } from "@langchain/core/messages";

// Memory module
import {
  estimateTokens,
  countMessageTokens,
  buildComprehensiveSummaryPrompt,
  getContextUsage,
  COMPRESSION_PROMPT,
  MEMORY_CONSTANTS,
} from "../agent/memory.js";

// Message utilities
import { extractTextContent, messagesToText, getMessageText } from "../utils/messages.js";

// Event system
import {
  agentEvents,
  emitThinking,
  emitToolUse,
  emitToolResult,
  emitResponse,
  emitDone,
  createToolAbortController,
  abortToolExecution,
  clearToolAbortController,
  setCurrentToolCallId,
  getCurrentToolCallId,
  clearToolCallIds,
  type AgentEventType,
} from "../agent/events.js";

// Tool metadata
import {
  TOOL_METADATA,
  getToolMetadata,
  getToolDescriptions,
  isReadOnlyTool,
  canRunToolsConcurrently,
  SENSITIVE_TOOLS,
} from "../tools/types.js";

// Tool index
import {
  allTools,
  getToolsForCurrentMode,
  getToolsByNames,
  toolDescriptions,
} from "../tools/index.js";

// Skills
import {
  loadAllSkills,
  clearSkillCache,
  getSkill,
  getSkillNames,
} from "../skills/loader.js";
import { getToolsForSkill, skillAllowsTool } from "../skills/index.js";

// Context
import {
  generateTodoContext,
  collectContextItems,
  formatContextAsReminder,
  wrapToolResult,
} from "../context/index.js";

// Frontmatter
import { parseFrontmatter } from "../utils/frontmatter.js";

// Todo
import { setTodos, clearTodos } from "../tools/todo.js";

describe("E2E: Memory + Message Utilities Integration", () => {
  test("messagesToText output feeds into compression prompt", () => {
    const messages = [
      new HumanMessage("Implement a REST API"),
      new AIMessage({
        content: "I'll create the endpoints",
        tool_calls: [{ id: "1", name: "Write", args: { file_path: "api.ts", content: "..." } }],
      }),
      new ToolMessage({ content: "File written successfully", tool_call_id: "1", name: "Write" }),
      new AIMessage("The API endpoints have been created."),
    ];

    // messagesToText → buildComprehensiveSummaryPrompt
    const textOnly = messagesToText(messages);
    expect(textOnly).toContain("User: Implement a REST API");
    expect(textOnly).toContain("Tool calls: Write");

    const fullPrompt = buildComprehensiveSummaryPrompt(messages);
    expect(fullPrompt).toContain(textOnly);
    expect(fullPrompt).toContain("Technical Context");
    expect(fullPrompt).toContain("Key Decisions");
  });

  test("extractTextContent works with countMessageTokens", () => {
    // Complex message with array content
    const msg = new HumanMessage({
      content: [
        { type: "text", text: "Analyze this code" },
        { type: "text", text: " and fix bugs" },
      ],
    });

    // extractTextContent should handle the array
    const text = extractTextContent(msg.content);
    expect(text).toBe("Analyze this code and fix bugs");

    // countMessageTokens should handle this message
    const tokens = countMessageTokens([msg]);
    expect(tokens).toBeGreaterThan(0);
  });

  test("context usage tracks message growth", () => {
    const base = [new HumanMessage("Hello")];
    const usage1 = getContextUsage(base, "test-model");

    // Add more messages
    const extended = [
      ...base,
      new AIMessage("Hi there!"),
      new HumanMessage("Can you help me with a complex task?"),
      new AIMessage("Of course! Let me analyze your code."),
    ];
    const usage2 = getContextUsage(extended, "test-model");

    expect(usage2.tokenCount).toBeGreaterThan(usage1.tokenCount);
    // percentUsed may both round to 0 for small messages against large context windows
    expect(usage2.percentUsed).toBeGreaterThanOrEqual(usage1.percentUsed);
    expect(usage2.tokensRemaining).toBeLessThan(usage1.tokensRemaining);
  });
});

describe("E2E: Event System + Tool Lifecycle", () => {
  beforeEach(() => {
    clearToolAbortController();
    clearToolCallIds();
  });

  test("full tool execution lifecycle emits correct events", () => {
    const events: AgentEventType[] = [];
    const listener = (data: AgentEventType) => { events.push(data); };

    agentEvents.on("agent", listener);

    // 1. Thinking
    emitThinking("test-model");

    // 2. Tool use
    createToolAbortController();
    setCurrentToolCallId("Read", "call_1");
    emitToolUse("Read", { file_path: "test.ts" }, "call_1");

    // 3. Tool result
    emitToolResult("Read", "file contents...", "call_1");
    clearToolAbortController();
    clearToolCallIds();

    // 4. Response
    emitResponse("I've read the file.");

    // 5. Done
    emitDone();

    agentEvents.off("agent", listener);

    expect(events).toHaveLength(5);
    expect(events[0].type).toBe("thinking");
    expect(events[1].type).toBe("tool_use");
    expect(events[2].type).toBe("tool_result");
    expect(events[3].type).toBe("response");
    expect(events[4].type).toBe("done");
  });

  test("abort controller lifecycle", () => {
    const controller = createToolAbortController();
    setCurrentToolCallId("Bash", "call_1");

    expect(getCurrentToolCallId("Bash")).toBe("call_1");
    expect(controller.signal.aborted).toBe(false);

    abortToolExecution();

    expect(controller.signal.aborted).toBe(true);

    clearToolAbortController();
    clearToolCallIds();

    expect(getCurrentToolCallId("Bash")).toBeNull();
  });
});

describe("E2E: Tool Metadata + Tool Filtering", () => {
  test("tool descriptions match metadata", () => {
    for (const desc of toolDescriptions) {
      const meta = TOOL_METADATA[desc.name];
      if (meta) {
        expect(desc.description).toBe(meta.description);
        expect(desc.readOnly).toBe(meta.isReadOnly);
      }
    }
  });

  test("getToolsByNames returns correct tools", () => {
    const tools = getToolsByNames(["Read", "Write", "Glob"]);
    const names = tools.map(t => t.name);
    expect(names).toContain("Read");
    expect(names).toContain("Write");
    expect(names).toContain("Glob");
    expect(names).not.toContain("Bash");
  });

  test("allTools count matches metadata count", () => {
    // Every tool in allTools should have metadata
    for (const tool of allTools) {
      const meta = getToolMetadata(tool.name);
      expect(meta).toBeDefined();
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  test("sensitive tools match permission metadata", () => {
    for (const toolName of SENSITIVE_TOOLS) {
      const meta = getToolMetadata(toolName);
      expect(meta.needsPermission).toBe(true);
    }
  });

  test("concurrent tool check works with metadata", () => {
    // Read-only tools can run concurrently
    expect(canRunToolsConcurrently(["Read", "Glob", "Grep", "LS"])).toBe(true);
    // Adding a write tool prevents concurrency
    expect(canRunToolsConcurrently(["Read", "Write"])).toBe(false);
  });
});

describe("E2E: Skill + Tool Integration", () => {
  beforeEach(() => {
    clearSkillCache();
  });

  test("researcher skill only has read-only tools", () => {
    const skill = getSkill("researcher");
    expect(skill).not.toBeNull();

    if (skill && skill.tools !== "*") {
      for (const toolName of skill.tools as string[]) {
        expect(isReadOnlyTool(toolName)).toBe(true);
      }
    }
  });

  test("code-writer skill includes write tools", () => {
    const skill = getSkill("code-writer");
    expect(skill).not.toBeNull();
    expect(skillAllowsTool(skill!, "Write")).toBe(true);
    expect(skillAllowsTool(skill!, "Edit")).toBe(true);
    expect(skillAllowsTool(skill!, "Read")).toBe(true);
  });

  test("general-purpose skill allows all tools", () => {
    const skill = getSkill("general-purpose");
    expect(skill).not.toBeNull();
    expect(skill!.tools).toBe("*");
    expect(skillAllowsTool(skill!, "Bash")).toBe(true);
    expect(skillAllowsTool(skill!, "WebSearch")).toBe(true);
  });

  test("getToolsForSkill returns filtered tools", () => {
    const researcherTools = getToolsForSkill("researcher");
    const researcherNames = researcherTools.map(t => t.name);
    expect(researcherNames).toContain("Read");
    expect(researcherNames).toContain("Glob");
    expect(researcherNames).not.toContain("Write");
    expect(researcherNames).not.toContain("Edit");
  });

  test("getToolsForSkill returns all tools for unknown skill", () => {
    const tools = getToolsForSkill("nonexistent");
    expect(tools.length).toBe(allTools.length);
  });
});

describe("E2E: Context Injection Pipeline", () => {
  test("todo changes flow through context system", () => {
    clearTodos();

    // No todos → no context
    const noTodoContext = generateTodoContext();
    expect(noTodoContext).toBeNull();

    // Add todo → context appears
    setTodos([
      { content: "Implement feature X", status: "in_progress", activeForm: "Implementing feature X" },
      { content: "Write tests", status: "pending", activeForm: "Writing tests" },
    ]);

    const todoContext = generateTodoContext();
    expect(todoContext).not.toBeNull();
    expect(todoContext).toContain("Implement feature X");

    // Context items include todo
    const items = collectContextItems();
    const todoItem = items.find(i => i.type === "todoReminder");
    expect(todoItem).toBeDefined();
    expect(todoItem!.priority).toBe(80);

    // Formatted as system reminder
    const formatted = formatContextAsReminder(items);
    if (items.length > 0) {
      expect(formatted).toContain("<system-reminder>");
    }

    clearTodos();
  });

  test("tool result wrapping adds appropriate context", () => {
    // Read tool gets malware warning
    const readResult = wrapToolResult("Read", "const secret = 'password';");
    expect(readResult).toContain("malware");

    // WebSearch doesn't get extra wrapping
    const searchResult = wrapToolResult("WebSearch", "search results...");
    expect(searchResult).toBe("search results...");
  });
});

describe("E2E: Frontmatter → Skill/Command Loading", () => {
  test("frontmatter parsing produces valid skill config fields", () => {
    const skillContent = `---
name: my-custom-skill
description: A custom skill for testing
whenToUse: When you need to test things
tools: [Read, Glob, Grep]
color: purple
readOnly: true
priority: 5
tags: [testing, custom]
---
You are a testing specialist.

Focus on:
- Writing comprehensive tests
- Edge case coverage`;

    const { frontmatter, body } = parseFrontmatter(skillContent);

    expect(frontmatter.name).toBe("my-custom-skill");
    expect(frontmatter.description).toBe("A custom skill for testing");
    expect(frontmatter.tools).toEqual(["Read", "Glob", "Grep"]);
    expect(frontmatter.color).toBe("purple");
    expect(frontmatter.readOnly).toBe(true);
    expect(frontmatter.priority).toBe(5);
    expect(frontmatter.tags).toEqual(["testing", "custom"]);
    expect(body).toContain("testing specialist");
    expect(body).toContain("Edge case coverage");
  });

  test("frontmatter parsing produces valid command config fields", () => {
    const commandContent = `---
description: Run project tests
aliases: [t, test]
progressMessage: Running tests...
---
Run the test suite using: $ARGUMENTS

If no arguments provided, run all tests with \`bun test\`.`;

    const { frontmatter, body } = parseFrontmatter(commandContent);

    expect(frontmatter.description).toBe("Run project tests");
    expect(frontmatter.aliases).toEqual(["t", "test"]);
    expect(frontmatter.progressMessage).toBe("Running tests...");
    expect(body).toContain("$ARGUMENTS");
    expect(body).toContain("bun test");
  });
});

describe("E2E: Compression Flow Simulation", () => {
  test("simulates auto-compact decision flow", () => {
    // Build up a conversation
    const messages = [];
    for (let i = 0; i < 50; i++) {
      messages.push(new HumanMessage(`User message ${i} with some content to increase token count`));
      messages.push(new AIMessage(`Assistant response ${i} with detailed explanation of the answer`));
    }

    // Check context usage
    const usage = getContextUsage(messages, "test-model");
    expect(usage.tokenCount).toBeGreaterThan(0);

    // Generate summary prompt
    const summaryPrompt = buildComprehensiveSummaryPrompt(messages);
    expect(summaryPrompt).toContain("Technical Context");
    expect(summaryPrompt).toContain("User message 0");
    expect(summaryPrompt).toContain("User message 49");

    // Token count of prompt itself should be significant
    const promptTokens = estimateTokens(summaryPrompt);
    expect(promptTokens).toBeGreaterThan(100);
  });

  test("compression preserves information density", () => {
    const messages = [
      new HumanMessage("Fix the authentication bug in auth.ts"),
      new AIMessage({
        content: "I'll read the file first",
        tool_calls: [{ id: "1", name: "Read", args: { file_path: "src/auth.ts" } }],
      }),
      new ToolMessage({
        content: "export function login(user: string, pass: string) { /* bug here */ }",
        tool_call_id: "1",
        name: "Read",
      }),
      new AIMessage("Found the bug. The login function doesn't validate inputs."),
      new HumanMessage("Please fix it"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "2", name: "Edit", args: { file_path: "src/auth.ts", old_string: "/* bug here */", new_string: "if (!user || !pass) throw new Error('Invalid credentials');" } }],
      }),
      new ToolMessage({ content: "File edited successfully", tool_call_id: "2", name: "Edit" }),
      new AIMessage("Fixed! Added input validation to the login function."),
    ];

    const summary = messagesToText(messages);
    expect(summary).toContain("auth"); // Key info preserved
    expect(summary).toContain("login"); // Function name preserved
    expect(summary).toContain("Read"); // Tool usage preserved
    expect(summary).toContain("Edit"); // Tool usage preserved
  });
});

describe("E2E: Memory Constants Consistency", () => {
  test("auto-compact threshold is between 0 and 1", () => {
    expect(MEMORY_CONSTANTS.AUTO_COMPACT_THRESHOLD).toBeGreaterThan(0);
    expect(MEMORY_CONSTANTS.AUTO_COMPACT_THRESHOLD).toBeLessThan(1);
  });

  test("overhead constants are positive", () => {
    expect(MEMORY_CONSTANTS.MESSAGE_OVERHEAD_TOKENS).toBeGreaterThan(0);
    expect(MEMORY_CONSTANTS.TOOL_CALL_OVERHEAD_TOKENS).toBeGreaterThan(0);
  });

  test("COMPRESSION_PROMPT is used by buildComprehensiveSummaryPrompt", () => {
    const prompt = buildComprehensiveSummaryPrompt([new HumanMessage("test")]);
    expect(prompt).toContain(COMPRESSION_PROMPT);
  });
});
