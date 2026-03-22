/**
 * Agent Events Tests
 *
 * Covers:
 * - Event emission and listening
 * - Typed event payloads
 * - Tool abort controller lifecycle
 * - Tool call ID tracking
 * - Convenience emit functions
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  agentEvents,
  emitThinking,
  emitStreaming,
  emitToolUse,
  emitToolProgress,
  emitToolResult,
  emitResponse,
  emitError,
  emitConfirmRequired,
  emitCompacting,
  emitAutoCompact,
  emitTokenUsage,
  emitBackgroundTask,
  emitDone,
  createToolAbortController,
  getToolAbortSignal,
  abortToolExecution,
  isToolAborted,
  clearToolAbortController,
  setCurrentToolCallId,
  getCurrentToolCallId,
  clearToolCallIds,
  type AgentEventType,
} from "../events.js";

// Helper to capture an event
function captureEvent(emitFn: () => void): any {
  let received: any = null;
  const listener = (data: AgentEventType) => { received = data; };
  agentEvents.on("agent", listener);
  emitFn();
  agentEvents.off("agent", listener);
  return received;
}

describe("AgentEventEmitter", () => {
  test("emits thinking event", () => {
    const e = captureEvent(() => emitThinking("gpt-4"));
    expect(e.type).toBe("thinking");
    expect(e.model).toBe("gpt-4");
  });

  test("emits streaming event with delta", () => {
    const e = captureEvent(() => emitStreaming("Hello World", " World"));
    expect(e.type).toBe("streaming");
    expect(e.content).toBe("Hello World");
    expect(e.delta).toBe(" World");
  });

  test("emits tool_use event", () => {
    const e = captureEvent(() => emitToolUse("Read", { file_path: "/test.ts" }, "call_123"));
    expect(e.type).toBe("tool_use");
    expect(e.name).toBe("Read");
    expect(e.args.file_path).toBe("/test.ts");
    expect(e.id).toBe("call_123");
  });

  test("emits tool_progress event", () => {
    const e = captureEvent(() => emitToolProgress("Bash", "call_1", "Installing...", 50, ["call_2"]));
    expect(e.type).toBe("tool_progress");
    expect(e.name).toBe("Bash");
    expect(e.percentage).toBe(50);
    expect(e.siblingIds).toEqual(["call_2"]);
  });

  test("emits tool_result event", () => {
    const e = captureEvent(() => emitToolResult("Read", "file contents...", "call_123", false));
    expect(e.type).toBe("tool_result");
    expect(e.name).toBe("Read");
    expect(e.result).toBe("file contents...");
    expect(e.isError).toBe(false);
  });

  test("emits error tool_result", () => {
    const e = captureEvent(() => emitToolResult("Bash", "command failed", "call_456", true));
    expect(e.type).toBe("tool_result");
    expect(e.isError).toBe(true);
  });

  test("emits response event", () => {
    const e = captureEvent(() => emitResponse("Here is the answer."));
    expect(e.type).toBe("response");
    expect(e.content).toBe("Here is the answer.");
  });

  test("emits error event", () => {
    const e = captureEvent(() => emitError("Something went wrong"));
    expect(e.type).toBe("error");
    expect(e.message).toBe("Something went wrong");
  });

  test("emits confirm_required with tool list", () => {
    const tools = [
      { name: "Bash", args: { command: "npm install" }, toolCallId: "call_1", commandPrefix: "npm" },
    ];
    const e = captureEvent(() => emitConfirmRequired(tools));
    expect(e.type).toBe("confirm_required");
    expect(e.tools).toHaveLength(1);
    expect(e.tools[0].name).toBe("Bash");
    expect(e.tools[0].commandPrefix).toBe("npm");
  });

  test("emits compacting event", () => {
    const e = captureEvent(() => emitCompacting(50000));
    expect(e.type).toBe("compacting");
    expect(e.tokenCount).toBe(50000);
  });

  test("emits auto_compact event", () => {
    const e = captureEvent(() => emitAutoCompact(100, 2, "Summary..."));
    expect(e.type).toBe("auto_compact");
    expect(e.messagesBefore).toBe(100);
    expect(e.messagesAfter).toBe(2);
    expect(e.summary).toBe("Summary...");
  });

  test("emits token_usage event", () => {
    const e = captureEvent(() => emitTokenUsage(50000, 128000, 39));
    expect(e.type).toBe("token_usage");
    expect(e.tokenCount).toBe(50000);
    expect(e.contextLimit).toBe(128000);
    expect(e.percentUsed).toBe(39);
  });

  test("emits background_task event", () => {
    const e = captureEvent(() => emitBackgroundTask("task_1", "npm install", "completed", "success"));
    expect(e.type).toBe("background_task");
    expect(e.taskId).toBe("task_1");
    expect(e.taskName).toBe("npm install");
    expect(e.status).toBe("completed");
    expect(e.result).toBe("success");
  });

  test("emits done event with interrupted=true", () => {
    const e = captureEvent(() => emitDone(true));
    expect(e.type).toBe("done");
    expect(e.interrupted).toBe(true);
  });

  test("emits done event with interrupted=false", () => {
    const e = captureEvent(() => emitDone());
    expect(e.type).toBe("done");
    expect(e.interrupted).toBe(false);
  });

  test("multiple listeners receive events", () => {
    let count = 0;
    const listener1 = () => { count++; };
    const listener2 = () => { count++; };

    agentEvents.on("agent", listener1);
    agentEvents.on("agent", listener2);
    emitThinking("test");
    agentEvents.off("agent", listener1);
    agentEvents.off("agent", listener2);

    expect(count).toBe(2);
  });
});

describe("Tool Abort Controller", () => {
  beforeEach(() => {
    clearToolAbortController();
  });

  test("creates abort controller", () => {
    const controller = createToolAbortController();
    expect(controller).toBeDefined();
    expect(controller.signal.aborted).toBe(false);
  });

  test("getToolAbortSignal returns signal after creation", () => {
    createToolAbortController();
    const signal = getToolAbortSignal();
    expect(signal).not.toBeNull();
    expect(signal!.aborted).toBe(false);
  });

  test("getToolAbortSignal returns null before creation", () => {
    expect(getToolAbortSignal()).toBeNull();
  });

  test("abortToolExecution aborts the controller", () => {
    createToolAbortController();
    expect(abortToolExecution()).toBe(true);
    expect(isToolAborted()).toBe(true);
  });

  test("abortToolExecution returns false if not created", () => {
    expect(abortToolExecution()).toBe(false);
  });

  test("abortToolExecution returns false if already aborted", () => {
    createToolAbortController();
    abortToolExecution();
    expect(abortToolExecution()).toBe(false);
  });

  test("clearToolAbortController resets state", () => {
    createToolAbortController();
    clearToolAbortController();
    expect(getToolAbortSignal()).toBeNull();
    expect(isToolAborted()).toBe(false);
  });
});

describe("Tool Call ID Tracking", () => {
  beforeEach(() => {
    clearToolCallIds();
  });

  test("sets and gets tool call ID", () => {
    setCurrentToolCallId("Read", "call_123");
    expect(getCurrentToolCallId("Read")).toBe("call_123");
  });

  test("returns null for unset tool", () => {
    expect(getCurrentToolCallId("NonExistent")).toBeNull();
  });

  test("tracks multiple tools independently", () => {
    setCurrentToolCallId("Read", "call_1");
    setCurrentToolCallId("Write", "call_2");
    expect(getCurrentToolCallId("Read")).toBe("call_1");
    expect(getCurrentToolCallId("Write")).toBe("call_2");
  });

  test("overwrites existing tool call ID", () => {
    setCurrentToolCallId("Read", "call_1");
    setCurrentToolCallId("Read", "call_2");
    expect(getCurrentToolCallId("Read")).toBe("call_2");
  });

  test("clearToolCallIds removes all", () => {
    setCurrentToolCallId("Read", "call_1");
    setCurrentToolCallId("Write", "call_2");
    clearToolCallIds();
    expect(getCurrentToolCallId("Read")).toBeNull();
    expect(getCurrentToolCallId("Write")).toBeNull();
  });
});
