/**
 * Plan Agent - LangGraph Subgraph for Planning Mode
 *
 * This module implements a specialized planning agent using LangGraph best practices:
 * - StateGraph for state management
 * - Read-only tools only (Glob, Grep, Read, LS, WebSearch, WebFetch)
 * - ExitPlanMode tool to transition back to normal mode
 * - Generates structured plans with implementation steps
 *
 * The plan agent helps with research and planning before implementation.
 */
import {
  StateGraph,
  Annotation,
  START,
  END,
} from "@langchain/langgraph";
import { AIMessage, HumanMessage, SystemMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { log } from "../../logger.js";
import { callChatModel } from "./models.js";
import { getAgentModel } from "./index.js";
import { setPermissionMode } from "../settings.js";
import {
  emitThinking,
  emitToolUse,
  emitToolResult,
  emitResponse,
  emitDone,
} from "./events.js";

// Import read-only tools
import { Read, Glob, Grep, LS } from "../tools/file.js";
import { WebSearch, WebFetch } from "../tools/web.js";
import { SavePlan } from "../tools/plan.js";

// ============ State Definition ============

/**
 * Plan Agent State using LangGraph Annotation
 */
const PlanAgentState = Annotation.Root({
  // User's planning request
  userRequest: Annotation<string>({
    reducer: (_, y) => y,
  }),

  // Generated plan content
  planContent: Annotation<string | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // Plan file path (if saved)
  planFilePath: Annotation<string | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // Messages for LLM conversation
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),

  // Status tracking
  status: Annotation<"researching" | "planning" | "completed" | "exited" | "error">({
    reducer: (_, y) => y,
    default: () => "researching",
  }),

  // Error message if any
  error: Annotation<string | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // Whether plan mode should be exited
  shouldExitPlanMode: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false,
  }),

  // Previous permission mode to restore
  previousMode: Annotation<string | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),
});

type PlanAgentStateType = typeof PlanAgentState.State;

// ============ Tools ============

/**
 * Tool for exiting plan mode and returning to normal mode
 */
const ExitPlanModeTool = tool(
  async ({ planSummary }: { planSummary?: string }) => {
    log.info("Exiting plan mode", { hasSummary: !!planSummary });

    // Will be handled by the agent to restore previous mode
    return JSON.stringify({
      action: "exit_plan_mode",
      summary: planSummary || "Plan mode completed",
    });
  },
  {
    name: "ExitPlanMode",
    description: `Exit plan mode and return to normal mode. Use this when:
1. You have completed your research and planning
2. You are ready to start implementation
3. The user wants to exit plan mode

Optionally provide a summary of what was planned.`,
    schema: z.object({
      planSummary: z.string().optional().describe("Brief summary of the planning completed"),
    }),
  }
);

// Combine read-only tools with plan-specific tools
// Note: SavePlan is imported from ../tools/plan.js
const planTools = [
  Read,
  Glob,
  Grep,
  LS,
  WebSearch,
  WebFetch,
  ExitPlanModeTool,
  SavePlan,
];

const toolNode = new ToolNode(planTools);

// ============ System Prompt ============

const PLAN_SYSTEM_PROMPT = `You are in **PLAN MODE** - a specialized research and planning mode.

## Your Role
You are a software architect and planner. Your job is to:
1. Research the codebase to understand the existing structure
2. Analyze requirements and constraints
3. Create detailed implementation plans
4. Identify potential issues and solutions

## Available Tools (Read-Only + Planning)
You can ONLY use these tools in plan mode:
- **Read**: Read file contents
- **Glob**: Find files by pattern
- **Grep**: Search for text in files
- **LS**: List directory contents
- **WebSearch**: Search the web for information
- **WebFetch**: Fetch and analyze web pages
- **SavePlan**: Save your plan to a file
- **ExitPlanMode**: Exit plan mode when ready to implement

## You CANNOT:
- Write, edit, or create files (except saving plans)
- Execute bash commands
- Make any modifications to the codebase

## Planning Guidelines

When creating a plan, structure it as:

### 1. Context & Understanding
- What is the current state?
- What are the constraints?
- What existing patterns should be followed?

### 2. Requirements Analysis
- What exactly needs to be done?
- What are the success criteria?
- What are the edge cases?

### 3. Implementation Steps
- Break down into specific, actionable tasks
- Order tasks by dependency
- Identify files that need to be created/modified

### 4. Technical Decisions
- What approaches were considered?
- Why was this approach chosen?
- What are the trade-offs?

### 5. Potential Issues
- What could go wrong?
- How to mitigate risks?
- What needs testing?

## When to Exit Plan Mode

Use the ExitPlanMode tool when:
- You have a complete understanding of what needs to be done
- You have created a detailed implementation plan
- The user is ready to start implementing

Remember: You are in read-only mode. Focus on research and planning only.`;

// ============ Nodes ============

/**
 * Node: Research and analyze using read-only tools
 */
async function researchNode(
  state: PlanAgentStateType,
  _config?: RunnableConfig
): Promise<Partial<PlanAgentStateType>> {
  log.nodeStart("plan/research", { userRequest: state.userRequest });

  emitThinking("Researching codebase...");

  try {
    // Build messages with system prompt
    const messages: BaseMessage[] = [
      new SystemMessage(PLAN_SYSTEM_PROMPT),
      ...state.messages,
    ];

    // If this is the first call, add the user request
    if (state.messages.length === 0) {
      messages.push(new HumanMessage(state.userRequest));
    }

    // Call LLM with plan tools
    const model = getAgentModel();
    const response = await callChatModel(messages, planTools, model, true);

    return {
      messages: [response],
      status: "researching",
    };
  } catch (error: any) {
    log.error("Research failed", { error: error.message });
    return {
      status: "error",
      error: `Research failed: ${error.message}`,
    };
  }
}

/**
 * Node: Execute tool calls
 */
async function executeToolsNode(
  state: PlanAgentStateType,
  config?: RunnableConfig
): Promise<Partial<PlanAgentStateType>> {
  log.nodeStart("plan/executeTools", {});

  const lastMessage = state.messages[state.messages.length - 1];
  const toolCalls = AIMessage.isInstance(lastMessage) ? lastMessage.tool_calls : undefined;

  if (!toolCalls || toolCalls.length === 0) {
    return {};
  }

  // Check for ExitPlanMode tool call
  const exitCall = toolCalls.find(tc => tc.name === "ExitPlanMode");
  if (exitCall) {
    log.info("ExitPlanMode tool called, will exit plan mode");
    // Execute the tool to get the summary
    emitToolUse("ExitPlanMode", exitCall.args as Record<string, unknown>, exitCall.id || `tool_${Date.now()}`);

    return {
      shouldExitPlanMode: true,
      status: "exited",
      messages: [
        new ToolMessage({
          content: "Exiting plan mode. You can now proceed with implementation.",
          tool_call_id: exitCall.id || `tool_${Date.now()}`,
          name: "ExitPlanMode",
        }),
      ],
    };
  }

  // Emit tool use events
  for (const tc of toolCalls) {
    emitToolUse(tc.name, tc.args as Record<string, unknown>, tc.id || `tool_${Date.now()}`);
  }

  try {
    // Execute tools
    const result = await toolNode.invoke({ messages: [lastMessage] }, config);

    // Emit tool results
    for (const msg of result.messages) {
      emitToolResult(
        msg.name || "tool",
        typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        msg.tool_call_id || `result_${Date.now()}`
      );
    }

    return {
      messages: result.messages,
    };
  } catch (error: any) {
    log.error("Tool execution failed", { error: error.message });
    return {
      status: "error",
      error: `Tool execution failed: ${error.message}`,
    };
  }
}

/**
 * Node: Finalize plan mode
 */
async function finalizeNode(
  state: PlanAgentStateType,
  _config?: RunnableConfig
): Promise<Partial<PlanAgentStateType>> {
  log.nodeStart("plan/finalize", { status: state.status, shouldExit: state.shouldExitPlanMode });

  if (state.shouldExitPlanMode) {
    // Restore previous mode
    const previousMode = state.previousMode || "default";
    setPermissionMode(previousMode as any);
    log.info("Restored previous permission mode", { mode: previousMode });

    emitResponse("Exited plan mode. Ready for implementation.");
    emitDone();

    return {
      status: "exited",
    };
  }

  // Continue in plan mode
  return {};
}

// ============ Conditional Edges ============

/**
 * Determine routing after research
 */
function shouldExecuteTools(state: PlanAgentStateType): "executeTools" | "finalize" | "error" {
  if (state.status === "error") {
    return "error";
  }

  const lastMessage = state.messages[state.messages.length - 1];
  const toolCalls = AIMessage.isInstance(lastMessage) ? lastMessage.tool_calls : undefined;

  if (toolCalls && toolCalls.length > 0) {
    log.conditionalEdge("research", "shouldExecuteTools", "executeTools");
    return "executeTools";
  }

  log.conditionalEdge("research", "shouldExecuteTools", "finalize");
  return "finalize";
}

/**
 * After tool execution, continue or finalize
 */
function afterToolExecution(state: PlanAgentStateType): "research" | "finalize" {
  // If exiting plan mode, go to finalize
  if (state.shouldExitPlanMode) {
    log.conditionalEdge("executeTools", "afterToolExecution", "finalize");
    return "finalize";
  }

  // Continue research
  log.conditionalEdge("executeTools", "afterToolExecution", "research");
  return "research";
}

// ============ Graph Construction ============

/**
 * Build the Plan Agent graph
 */
function buildPlanAgentGraph() {
  const graph = new StateGraph(PlanAgentState)
    .addNode("research", researchNode)
    .addNode("executeTools", executeToolsNode)
    .addNode("finalize", finalizeNode)

    .addEdge(START, "research")
    .addConditionalEdges("research", shouldExecuteTools, {
      executeTools: "executeTools",
      finalize: "finalize",
      error: "finalize",
    })
    .addConditionalEdges("executeTools", afterToolExecution, {
      research: "research",
      finalize: "finalize",
    })
    .addEdge("finalize", END);

  return graph.compile();
}

// Compile the graph once
const planAgentGraph = buildPlanAgentGraph();

// ============ Public API ============

export interface PlanAgentResult {
  success: boolean;
  message: string;
  planContent?: string;
  exited: boolean;
}

/**
 * Run the plan agent for research and planning
 */
export async function runPlanAgent(userRequest: string, previousMode?: string): Promise<PlanAgentResult> {
  log.info("Starting plan agent", { userRequest: userRequest.slice(0, 100) });

  try {
    const result = await planAgentGraph.invoke({
      userRequest,
      previousMode: previousMode || "default",
    });

    if (result.status === "error") {
      return {
        success: false,
        message: result.error || "Unknown error occurred",
        exited: false,
      };
    }

    return {
      success: true,
      message: result.shouldExitPlanMode
        ? "Plan mode completed. Ready for implementation."
        : "Research completed.",
      planContent: result.planContent || undefined,
      exited: result.shouldExitPlanMode,
    };
  } catch (error: any) {
    log.error("Plan agent failed", { error: error.message });
    return {
      success: false,
      message: `Planning failed: ${error.message}`,
      exited: false,
    };
  }
}

/**
 * Get the read-only tools for plan mode
 */
export function getPlanModeTools() {
  return planTools;
}

// Export for testing
export { planAgentGraph, PlanAgentState, ExitPlanModeTool };
