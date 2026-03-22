/**
 * Multi-Agent Supervisor
 *
 * Uses @langchain/langgraph-supervisor to create a hierarchical multi-agent system.
 * The supervisor coordinates specialized agents:
 * - researcher: Read-only codebase exploration and web research
 * - coder: File operations and bash commands for implementation
 *
 * This is the default agent mode. The supervisor graph is used directly in
 * multiTurnChat() when agentMode is "supervisor".
 */

import { createSupervisor } from "@langchain/langgraph-supervisor";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { log } from "../../logger.js";
import { getChatModel } from "./models.js";
import { createCheckpointer, type Checkpointer } from "./checkpointer.js";
import { extractTextContent } from "../utils/messages.js";
import {
  emitThinking,
  emitResponse,
  emitToolUse,
  emitToolResult,
  emitError,
  emitDone,
  createToolAbortController,
  clearToolAbortController,
  setCurrentToolCallId,
  clearToolCallIds,
  abortToolExecution,
} from "./events.js";

// Import tools by category
import { Read, Glob, Grep, LS } from "../tools/file.js";
import { WebSearch, WebFetch } from "../tools/web.js";
import { Bash } from "../tools/bash.js";
import { Write, Edit } from "../tools/file.js";
import { TodoWrite } from "../tools/todo.js";

// ============ Agent Definitions ============

/**
 * Create the researcher agent - specialized in codebase exploration and web research.
 * Only has read-only tools.
 */
function createResearcherAgent(modelName: string) {
  const model = getChatModel(modelName);

  return createReactAgent({
    llm: model,
    tools: [Read, Glob, Grep, LS, WebSearch, WebFetch],
    name: "researcher",
    prompt: `You are a specialized research agent. Your role is to:
1. Explore and understand codebases using file search and reading tools
2. Search the web for documentation, best practices, and solutions
3. Analyze code patterns, dependencies, and architecture
4. Report your findings clearly and concisely

Focus on gathering information. Do NOT modify any files.
Always provide specific file paths and code references in your findings.`,
  });
}

/**
 * Create the coder agent - specialized in code implementation.
 * Has file write and bash tools.
 */
function createCoderAgent(modelName: string) {
  const model = getChatModel(modelName);

  return createReactAgent({
    llm: model,
    tools: [Read, Write, Edit, Bash, Glob, Grep, LS, TodoWrite],
    name: "coder",
    prompt: `You are a specialized coding agent. Your role is to:
1. Implement code changes based on research findings and plans
2. Write, edit, and create files as needed
3. Run bash commands for building, testing, and validation
4. Track progress using the TodoWrite tool

Focus on clean, correct implementation. Follow existing code patterns.
Before making changes, use Read to understand the existing code.
After changes, verify with appropriate tests or type checks.`,
  });
}

// ============ Supervisor ============

const SUPERVISOR_PROMPT = `You are a project supervisor coordinating a team of specialized agents.

## Your Team
- **researcher**: Expert at exploring codebases, reading files, searching for patterns, and web research. Use for understanding existing code, finding documentation, and gathering information.
- **coder**: Expert at implementing code changes, writing files, running commands, and tracking tasks. Use for making modifications, running builds/tests, and implementation work.

## Your Strategy
1. For complex tasks, start by delegating research to the researcher agent
2. Once you have sufficient understanding, delegate implementation to the coder agent
3. After implementation, you may ask the researcher to verify changes
4. Coordinate between agents to ensure smooth workflow

## Guidelines
- Break complex tasks into research and implementation phases
- Provide clear, specific instructions to each agent
- Synthesize findings from the researcher before passing to the coder
- Track overall progress and ensure all requirements are met
- If an agent reports an issue, adjust the plan accordingly
- For simple questions or conversations, respond directly without delegating`;

// ============ Singleton Graph & State ============

// Supervisor graph (lazy init, persisted across calls for multi-turn)
let supervisorGraph: ReturnType<ReturnType<typeof createSupervisor>["compile"]> | null = null;
let supervisorCheckpointer: Checkpointer | null = null;
let supervisorModelName: string | null = null;

/**
 * Get or create the supervisor graph.
 * Rebuilds if model has changed.
 */
function getSupervisorGraph(modelName: string) {
  if (supervisorGraph && supervisorModelName === modelName) {
    return supervisorGraph;
  }

  log.info("Building supervisor graph", { model: modelName });

  const model = getChatModel(modelName);
  const researcher = createResearcherAgent(modelName);
  const coder = createCoderAgent(modelName);

  const workflow = createSupervisor({
    agents: [researcher, coder] as any,
    llm: model,
    prompt: SUPERVISOR_PROMPT,
    outputMode: "last_message",
  });

  if (!supervisorCheckpointer) {
    supervisorCheckpointer = createCheckpointer();
  }

  supervisorGraph = workflow.compile({ checkpointer: supervisorCheckpointer });
  supervisorModelName = modelName;
  return supervisorGraph;
}

// ============ Stream Event Handling ============

/**
 * Handle stream updates from the supervisor graph.
 * Emits UI events for tool use, tool results, and responses.
 */
function handleSupervisorStreamUpdate(nodeName: string, update: any): void {
  log.debug("Supervisor stream update", {
    node: nodeName,
    messageCount: update.messages?.length || 0,
  });

  if (!update.messages) return;

  for (const msg of update.messages) {
    // AI messages - emit response and/or tool use events
    if (AIMessage.isInstance(msg)) {
      const content = extractTextContent(msg.content);
      if (content && content.trim()) {
        emitResponse(content);
      }

      const toolCalls = msg.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        log.info("Supervisor agent requesting tool calls", {
          node: nodeName,
          toolCount: toolCalls.length,
          tools: toolCalls.map((tc: any) => tc.name),
        });

        createToolAbortController();
        for (const tc of toolCalls) {
          const toolCallId = tc.id || `tool_${Date.now()}`;
          setCurrentToolCallId(tc.name, toolCallId);
          emitToolUse(tc.name, tc.args as Record<string, unknown>, toolCallId);
        }
      }
    }

    // Tool messages - emit tool result events
    if (msg instanceof ToolMessage) {
      clearToolAbortController();
      clearToolCallIds();

      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      log.info("Supervisor tool result", {
        tool: msg.name || "unknown",
        resultLength: content.length,
      });
      emitToolResult(msg.name || "tool", content, msg.tool_call_id || `result_${Date.now()}`);
    }
  }
}

// ============ Public API ============

interface SupervisorStreamResult {
  messages: BaseMessage[];
  interrupted: boolean;
}

// AbortController for current supervisor request
let supervisorAbortController: AbortController | null = null;

/**
 * Abort current supervisor request
 */
export function abortSupervisorRequest(): boolean {
  let aborted = false;

  if (supervisorAbortController && !supervisorAbortController.signal.aborted) {
    supervisorAbortController.abort();
    aborted = true;
  }

  if (abortToolExecution()) {
    aborted = true;
  }

  if (aborted) {
    log.info("Supervisor request aborted by user");
  }
  return aborted;
}

// Maximum retries for transient errors (network, rate limits)
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

/**
 * Check if an error is transient and worth retrying.
 */
function isRetryableError(error: any): boolean {
  if (!error) return false;
  const msg = error.message?.toLowerCase() || "";
  const code = error.code || error.status || 0;
  // Network errors, rate limits, server errors
  return (
    msg.includes("network") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("timeout") ||
    msg.includes("rate limit") ||
    msg.includes("429") ||
    code === 429 ||
    code === 502 ||
    code === 503 ||
    code === 504
  );
}

/**
 * Run the supervisor graph with streaming, emitting events for UI.
 * Includes retry logic for transient errors (network, rate limits).
 */
export async function runSupervisorStream(
  input: { messages: BaseMessage[] },
  threadId: string,
  modelName: string,
): Promise<SupervisorStreamResult> {
  const startTime = Date.now();
  supervisorAbortController = new AbortController();
  const signal = supervisorAbortController.signal;

  const graph = getSupervisorGraph(modelName);
  const config: RunnableConfig = {
    configurable: { thread_id: threadId },
    recursionLimit: Number.MAX_SAFE_INTEGER,
  };

  log.info("Supervisor stream started", { threadId, modelName });
  emitThinking(modelName);

  let allMessages: BaseMessage[] = input.messages ? [...input.messages] : [];
  let nodeCount = 0;
  let wasInterrupted = false;
  let lastError: any = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1] || 4000;
      log.info("Retrying supervisor stream", { attempt, delay, error: lastError?.message });
      await new Promise(resolve => setTimeout(resolve, delay));
      if (signal.aborted) {
        return { messages: allMessages, interrupted: true };
      }
      emitThinking(modelName);
    }

    try {
      const stream = await graph.stream(
        attempt === 0 ? input : null, // Only send input on first attempt; retries resume from checkpoint
        {
          ...config,
          streamMode: "updates",
          signal,
        },
      );

      for await (const chunk of stream) {
        if (signal.aborted) {
          log.info("Supervisor stream aborted by user");
          wasInterrupted = true;
          break;
        }

        for (const [nodeName, update] of Object.entries(chunk)) {
          nodeCount++;
          log.debug("Processing supervisor stream chunk", { nodeCount, nodeName });
          handleSupervisorStreamUpdate(nodeName, update);

          if ((update as any).messages) {
            allMessages = [...allMessages, ...(update as any).messages];
          }
        }
      }

      // Success - break out of retry loop
      lastError = null;
      break;
    } catch (error: any) {
      if (error.name === "AbortError" || signal.aborted) {
        log.info("Supervisor request aborted");
        return { messages: allMessages, interrupted: true };
      }

      lastError = error;

      if (isRetryableError(error) && attempt < MAX_RETRIES) {
        log.warn("Supervisor stream transient error, will retry", {
          attempt,
          error: error.message,
        });
        continue;
      }

      // Non-retryable or max retries exhausted
      log.error("Supervisor stream failed", { error: error.message, attempts: attempt + 1 });
      throw error;
    }
  }

  supervisorAbortController = null;

  const durationMs = Date.now() - startTime;
  log.info("Supervisor stream completed", {
    threadId,
    totalMessages: allMessages.length,
    nodesExecuted: nodeCount,
    durationMs,
    wasInterrupted,
  });

  return { messages: allMessages, interrupted: wasInterrupted };
}

/**
 * Reset the supervisor graph (e.g., when model changes)
 */
export function resetSupervisorGraph(): void {
  supervisorGraph = null;
  supervisorModelName = null;
  log.info("Supervisor graph reset");
}
