/**
 * Plan Agent - LangChain 1.0 createAgent for Planning Mode
 *
 * Migrated from custom StateGraph to LangChain 1.0's createAgent.
 * Uses read-only tools + ExitPlanMode for plan mode research and planning.
 *
 * The plan agent helps with research and planning before implementation.
 */
import { createAgent, tool } from "langchain";
import { z } from "zod";
import { log } from "../../logger.js";
import { getChatModel } from "./models.js";
import { getAgentModel } from "./index.js";
import { setPermissionMode } from "../settings.js";
import {
  emitThinking,
  emitResponse,
  emitDone,
} from "./events.js";

// Import read-only tools
import { Read, Glob, Grep, LS } from "../tools/file.js";
import { WebSearch, WebFetch } from "../tools/web.js";
import { SavePlan } from "../tools/plan.js";

// ============ Tools ============

/**
 * Tool for exiting plan mode and returning to normal mode
 */
const ExitPlanModeTool = tool(
  async ({ planSummary }: { planSummary?: string }) => {
    log.info("Exiting plan mode", { hasSummary: !!planSummary });
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

// ============ Agent Creation ============

/**
 * Create the plan agent using LangChain 1.0 createAgent
 */
function buildPlanAgent() {
  const model = getChatModel(getAgentModel());

  return createAgent({
    model,
    tools: planTools,
    systemPrompt: PLAN_SYSTEM_PROMPT,
    name: "plan-agent",
  });
}

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
    emitThinking("Researching codebase...");

    const agent = buildPlanAgent();

    const result = await agent.invoke({
      messages: [
        {
          role: "user",
          content: userRequest,
        },
      ],
    });

    // Check if ExitPlanMode was called by examining tool messages
    const messages = result.messages || [];
    let exited = false;

    for (const msg of messages) {
      if (msg.name === "ExitPlanMode" || (typeof msg.content === "string" && msg.content.includes("exit_plan_mode"))) {
        exited = true;
        break;
      }
    }

    if (exited) {
      // Restore previous permission mode
      const restoreMode = previousMode || "default";
      setPermissionMode(restoreMode as any);
      log.info("Restored previous permission mode", { mode: restoreMode });

      emitResponse("Exited plan mode. Ready for implementation.");
      emitDone();

      return {
        success: true,
        message: "Plan mode completed. Ready for implementation.",
        exited: true,
      };
    }

    // Extract last AI response for the plan content
    const lastAIMsg = [...messages].reverse().find(
      (m: any) => m._getType?.() === "ai" || m.constructor?.name === "AIMessage"
    );
    const planContent = lastAIMsg
      ? (typeof lastAIMsg.content === "string" ? lastAIMsg.content : String(lastAIMsg.content))
      : undefined;

    emitDone();

    return {
      success: true,
      message: "Research completed.",
      planContent,
      exited: false,
    };
  } catch (error: any) {
    log.error("Plan agent failed", { error: error.message });
    emitDone();
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
export { ExitPlanModeTool };
