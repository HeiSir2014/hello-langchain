/**
 * Init Agent - LangGraph Subgraph for CLAUDE.md Generation
 *
 * This module implements a specialized agent using LangGraph best practices:
 * - StateGraph for state management
 * - Conditional edges for routing logic
 * - Node-based architecture for separation of concerns
 * - Tool integration for file operations
 *
 * The init agent analyzes the codebase and generates/improves CLAUDE.md
 */
import {
  StateGraph,
  Annotation,
  START,
  END,
} from "@langchain/langgraph";
import { AIMessage, HumanMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { log } from "../../logger.js";
import { callChatModel } from "./models.js";
import { getAgentModel } from "./index.js";
import {
  collectCodebaseContext,
  formatCodebaseContextForPrompt,
  type CodebaseContext,
} from "../services/codebase.js";
import {
  markOnboardingComplete,
  getProductFilePath,
  hasProductFile,
} from "../services/projectConfig.js";
import {
  emitThinking,
  emitToolUse,
  emitToolResult,
  emitResponse,
  emitDone,
} from "./events.js";

// ============ State Definition ============

/**
 * Init Agent State using LangGraph Annotation
 * Following best practices for state management
 */
const InitAgentState = Annotation.Root({
  // Input
  userRequest: Annotation<string>({
    reducer: (_, y) => y,
  }),

  // Context gathered from codebase analysis
  codebaseContext: Annotation<CodebaseContext | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // The generated/improved CLAUDE.md content
  generatedContent: Annotation<string | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // Messages for LLM conversation
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),

  // Status tracking
  status: Annotation<"pending" | "analyzing" | "generating" | "writing" | "completed" | "error">({
    reducer: (_, y) => y,
    default: () => "pending",
  }),

  // Error message if any
  error: Annotation<string | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // Whether this is an update or new creation
  isUpdate: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false,
  }),
});

type InitAgentStateType = typeof InitAgentState.State;

// ============ Tools ============

/**
 * Tool for writing CLAUDE.md file
 */
const writeClaudeMdTool = tool(
  async ({ content }: { content: string }) => {
    const filePath = getProductFilePath();
    try {
      writeFileSync(filePath, content, "utf-8");
      log.info("CLAUDE.md written successfully", { path: filePath });
      return `Successfully wrote CLAUDE.md to ${filePath}`;
    } catch (error: any) {
      log.error("Failed to write CLAUDE.md", { error: error.message });
      return `Error writing CLAUDE.md: ${error.message}`;
    }
  },
  {
    name: "WriteClaudeMd",
    description: "Write the generated content to CLAUDE.md file in the project root",
    schema: z.object({
      content: z.string().describe("The markdown content to write to CLAUDE.md"),
    }),
  }
);

/**
 * Tool for reading existing CLAUDE.md
 */
const readClaudeMdTool = tool(
  async () => {
    const filePath = getProductFilePath();
    if (!existsSync(filePath)) {
      return "CLAUDE.md does not exist yet.";
    }
    try {
      const content = readFileSync(filePath, "utf-8");
      return content;
    } catch (error: any) {
      return `Error reading CLAUDE.md: ${error.message}`;
    }
  },
  {
    name: "ReadClaudeMd",
    description: "Read the existing CLAUDE.md file if it exists",
    schema: z.object({}),
  }
);

const initTools = [writeClaudeMdTool, readClaudeMdTool];
const toolNode = new ToolNode(initTools);

// ============ System Prompt ============

const INIT_SYSTEM_PROMPT = `You are a specialized agent for analyzing codebases and generating CLAUDE.md documentation files.

Your task is to analyze the provided codebase context and create a comprehensive but concise CLAUDE.md file that will help AI coding agents (like yourself) work effectively in this repository.

## Guidelines for CLAUDE.md

The file should be approximately 50-100 lines and include:

1. **Build & Run Commands** (REQUIRED)
   - How to install dependencies
   - How to build the project
   - How to run in development mode
   - How to run tests (especially a single test)
   - How to run linting/formatting

2. **Code Style Guidelines** (REQUIRED)
   - Import conventions (ESM vs CommonJS, absolute vs relative)
   - Formatting preferences (tabs vs spaces, semicolons, quotes)
   - Type annotations (TypeScript strictness, any usage)
   - Naming conventions (camelCase, PascalCase, etc.)
   - Error handling patterns
   - Comments and documentation style

3. **Architecture Overview** (RECOMMENDED)
   - Project structure explanation
   - Key directories and their purposes
   - Main entry points
   - Core components/modules

4. **Development Patterns** (RECOMMENDED)
   - How to add new features
   - How to add new components/modules
   - Testing patterns
   - Common patterns used in the codebase

## Important Rules

- If a CLAUDE.md already exists, IMPROVE it rather than replace it entirely
- Preserve any custom sections the user may have added
- Include any Cursor rules (.cursor/rules/) or Copilot instructions (.github/copilot-instructions.md) you find
- Be specific to THIS project - don't give generic advice
- Use actual file paths and command examples from the project
- Keep it practical and actionable

After analyzing the codebase, use the WriteClaudeMd tool to write the file.`;

// ============ Nodes ============

/**
 * Node: Analyze codebase and gather context
 */
async function analyzeNode(
  state: InitAgentStateType,
  _config?: RunnableConfig
): Promise<Partial<InitAgentStateType>> {
  log.nodeStart("init/analyze", { userRequest: state.userRequest });

  emitThinking("Analyzing codebase...");

  try {
    const context = collectCodebaseContext();
    const isUpdate = hasProductFile();

    log.info("Codebase analysis complete", {
      isUpdate,
      hasReadme: !!context.projectDocs.readmeMd,
      hasClaudeMd: !!context.projectDocs.claudeMd,
      framework: context.codeStyle.framework,
    });

    return {
      codebaseContext: context,
      isUpdate,
      status: "analyzing",
    };
  } catch (error: any) {
    log.error("Codebase analysis failed", { error: error.message });
    return {
      status: "error",
      error: `Failed to analyze codebase: ${error.message}`,
    };
  }
}

/**
 * Node: Generate CLAUDE.md content using LLM
 */
async function generateNode(
  state: InitAgentStateType,
  _config?: RunnableConfig
): Promise<Partial<InitAgentStateType>> {
  log.nodeStart("init/generate", { isUpdate: state.isUpdate });

  if (!state.codebaseContext) {
    return {
      status: "error",
      error: "No codebase context available",
    };
  }

  emitThinking("Generating CLAUDE.md content...");

  try {
    // Build the prompt with codebase context
    const contextPrompt = formatCodebaseContextForPrompt(state.codebaseContext);

    const userPrompt = state.isUpdate
      ? `Please analyze this codebase and IMPROVE the existing CLAUDE.md file.

${contextPrompt}

Focus on:
1. Updating any outdated information
2. Adding missing sections
3. Preserving custom content the user may have added
4. Making it more specific and actionable

Use the WriteClaudeMd tool to write the improved file.`
      : `Please analyze this codebase and CREATE a new CLAUDE.md file.

${contextPrompt}

Create a comprehensive but concise documentation file following the guidelines in your system prompt.

Use the WriteClaudeMd tool to write the file.`;

    const messages: BaseMessage[] = [
      new SystemMessage(INIT_SYSTEM_PROMPT),
      new HumanMessage(userPrompt),
    ];

    // Call LLM with tools
    const model = getAgentModel();
    const response = await callChatModel(messages, initTools, model, true);

    return {
      messages: [response],
      status: "generating",
    };
  } catch (error: any) {
    log.error("Content generation failed", { error: error.message });
    return {
      status: "error",
      error: `Failed to generate content: ${error.message}`,
    };
  }
}

/**
 * Node: Execute tool calls (write file)
 */
async function executeToolsNode(
  state: InitAgentStateType,
  config?: RunnableConfig
): Promise<Partial<InitAgentStateType>> {
  log.nodeStart("init/executeTools", {});

  const lastMessage = state.messages[state.messages.length - 1];
  const toolCalls = AIMessage.isInstance(lastMessage) ? lastMessage.tool_calls : undefined;

  if (!toolCalls || toolCalls.length === 0) {
    return { status: "completed" };
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
      status: "writing",
    };
  } catch (error: any) {
    log.error("Tool execution failed", { error: error.message });
    return {
      status: "error",
      error: `Failed to execute tools: ${error.message}`,
    };
  }
}

/**
 * Node: Finalize and mark onboarding complete
 */
async function finalizeNode(
  state: InitAgentStateType,
  _config?: RunnableConfig
): Promise<Partial<InitAgentStateType>> {
  log.nodeStart("init/finalize", { status: state.status });

  if (state.status === "error") {
    return {};
  }

  // Mark onboarding as complete
  markOnboardingComplete();

  const action = state.isUpdate ? "updated" : "created";
  const successMessage = `Successfully ${action} CLAUDE.md with project documentation.`;

  emitResponse(successMessage);
  emitDone();

  log.info("Init agent completed", { action });

  return {
    status: "completed",
    generatedContent: successMessage,
  };
}

// ============ Conditional Edges ============

/**
 * Determine if we should continue to tools or finalize
 */
function shouldExecuteTools(state: InitAgentStateType): "executeTools" | "finalize" | "error" {
  if (state.status === "error") {
    return "error";
  }

  const lastMessage = state.messages[state.messages.length - 1];
  const toolCalls = AIMessage.isInstance(lastMessage) ? lastMessage.tool_calls : undefined;

  if (toolCalls && toolCalls.length > 0) {
    log.conditionalEdge("generate", "shouldExecuteTools", "executeTools");
    return "executeTools";
  }

  log.conditionalEdge("generate", "shouldExecuteTools", "finalize");
  return "finalize";
}

/**
 * After tool execution, continue generating or finalize
 */
function afterToolExecution(state: InitAgentStateType): "generate" | "finalize" {
  // Check if we need to continue the conversation
  const lastMessage = state.messages[state.messages.length - 1];

  // If the last message is a tool result, go back to generate for more processing
  if (lastMessage && "tool_call_id" in lastMessage) {
    log.conditionalEdge("executeTools", "afterToolExecution", "generate");
    return "generate";
  }

  log.conditionalEdge("executeTools", "afterToolExecution", "finalize");
  return "finalize";
}

// ============ Graph Construction ============

/**
 * Build the Init Agent graph following LangGraph best practices
 */
function buildInitAgentGraph() {
  const graph = new StateGraph(InitAgentState)
    // Add nodes
    .addNode("analyze", analyzeNode)
    .addNode("generate", generateNode)
    .addNode("executeTools", executeToolsNode)
    .addNode("finalize", finalizeNode)

    // Define edges
    .addEdge(START, "analyze")
    .addEdge("analyze", "generate")
    .addConditionalEdges("generate", shouldExecuteTools, {
      executeTools: "executeTools",
      finalize: "finalize",
      error: "finalize",
    })
    .addConditionalEdges("executeTools", afterToolExecution, {
      generate: "generate",
      finalize: "finalize",
    })
    .addEdge("finalize", END);

  return graph.compile();
}

// Compile the graph once
const initAgentGraph = buildInitAgentGraph();

// ============ Public API ============

export interface InitAgentResult {
  success: boolean;
  message: string;
  isUpdate: boolean;
}

/**
 * Run the init agent to generate/improve CLAUDE.md
 */
export async function runInitAgent(userRequest?: string): Promise<InitAgentResult> {
  log.info("Starting init agent", { hasUserRequest: !!userRequest });

  try {
    const result = await initAgentGraph.invoke({
      userRequest: userRequest || "Initialize CLAUDE.md for this project",
    });

    if (result.status === "error") {
      return {
        success: false,
        message: result.error || "Unknown error occurred",
        isUpdate: result.isUpdate,
      };
    }

    return {
      success: true,
      message: result.generatedContent || "CLAUDE.md has been generated successfully",
      isUpdate: result.isUpdate,
    };
  } catch (error: any) {
    log.error("Init agent failed", { error: error.message });
    return {
      success: false,
      message: `Failed to initialize: ${error.message}`,
      isUpdate: false,
    };
  }
}

// Export the graph for testing/debugging
export { initAgentGraph, InitAgentState };
