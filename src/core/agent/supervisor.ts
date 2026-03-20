/**
 * Multi-Agent Supervisor
 *
 * Uses @langchain/langgraph-supervisor to create a hierarchical multi-agent system.
 * The supervisor coordinates specialized agents:
 * - researcher: Read-only codebase exploration and web research
 * - coder: File operations and bash commands for implementation
 *
 * This enables complex tasks to be broken into research and implementation phases,
 * with the supervisor orchestrating the workflow.
 */

import { createSupervisor } from "@langchain/langgraph-supervisor";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { log } from "../../logger.js";
import { getChatModel } from "./models.js";
import { getAgentModel } from "./index.js";
import { createCheckpointer } from "./checkpointer.js";
import {
  emitThinking,
  emitResponse,
  emitDone,
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
function createResearcherAgent() {
  const model = getChatModel(getAgentModel());

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
function createCoderAgent() {
  const model = getChatModel(getAgentModel());

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
- If an agent reports an issue, adjust the plan accordingly`;

/**
 * Build the multi-agent supervisor graph.
 * Returns a compiled graph ready for invocation.
 */
export function buildSupervisorGraph() {
  const model = getChatModel(getAgentModel());

  const researcher = createResearcherAgent();
  const coder = createCoderAgent();

  const workflow = createSupervisor({
    agents: [researcher, coder] as any,
    llm: model,
    prompt: SUPERVISOR_PROMPT,
    outputMode: "last_message",
  });

  const checkpointer = createCheckpointer();
  return workflow.compile({ checkpointer });
}

// ============ Public API ============

export interface SupervisorResult {
  success: boolean;
  message: string;
  messages: BaseMessage[];
}

/**
 * Run the multi-agent supervisor for complex tasks.
 *
 * @param userRequest - The user's task description
 * @param threadId - Optional thread ID for conversation persistence
 */
export async function runSupervisor(
  userRequest: string,
  threadId?: string
): Promise<SupervisorResult> {
  log.info("Starting supervisor", { userRequest: userRequest.slice(0, 100) });

  try {
    emitThinking("Coordinating agents...");

    const graph = buildSupervisorGraph();
    const config = threadId
      ? { configurable: { thread_id: threadId } }
      : undefined;

    const result = await graph.invoke(
      {
        messages: [new HumanMessage(userRequest)],
      },
      config
    );

    const messages: BaseMessage[] = result.messages || [];

    // Extract the final supervisor response
    const lastMsg = messages[messages.length - 1];
    const content = lastMsg
      ? (typeof lastMsg.content === "string" ? lastMsg.content : String(lastMsg.content))
      : "Task completed.";

    emitResponse(content);
    emitDone();

    log.info("Supervisor completed", {
      totalMessages: messages.length,
    });

    return {
      success: true,
      message: content,
      messages,
    };
  } catch (error: any) {
    log.error("Supervisor failed", { error: error.message });
    emitDone();
    return {
      success: false,
      message: `Supervisor failed: ${error.message}`,
      messages: [],
    };
  }
}
