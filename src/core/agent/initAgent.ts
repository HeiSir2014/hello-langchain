/**
 * Init Agent - LangChain 1.0 createAgent for Project Instructions Generation
 *
 * Migrated from custom StateGraph to LangChain 1.0's createAgent with middleware.
 * Uses createMiddleware to inject codebase context before the model call.
 *
 * The init agent analyzes the codebase and generates/improves AGENT.md or CLAUDE.md
 */
import { createAgent, createMiddleware, tool } from "langchain";
import { z } from "zod";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { log } from "../../logger.js";
import { getChatModel } from "./models.js";
import { getAgentModel } from "./index.js";
import {
  collectCodebaseContext,
  formatCodebaseContextForPrompt,
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

// ============ Tools ============

/**
 * Tool for writing project instructions file (AGENT.md or CLAUDE.md)
 */
const writeClaudeMdTool = tool(
  async ({ content }: { content: string }) => {
    const filePath = getProductFilePath();
    const fileName = filePath.split("/").pop() || "CLAUDE.md";
    try {
      writeFileSync(filePath, content, "utf-8");
      log.info("Instructions file written successfully", { path: filePath });

      // Mark onboarding complete when file is written
      markOnboardingComplete();

      return `Successfully wrote ${fileName} to ${filePath}`;
    } catch (error: any) {
      log.error("Failed to write instructions file", { error: error.message });
      return `Error writing ${fileName}: ${error.message}`;
    }
  },
  {
    name: "WriteClaudeMd",
    description: "Write the generated content to the project instructions file (AGENT.md or CLAUDE.md) in the project root",
    schema: z.object({
      content: z.string().describe("The markdown content to write to the instructions file"),
    }),
  }
);

/**
 * Tool for reading existing instructions file (AGENT.md or CLAUDE.md)
 */
const readClaudeMdTool = tool(
  async () => {
    const filePath = getProductFilePath();
    if (!existsSync(filePath)) {
      return "No instructions file (AGENT.md or CLAUDE.md) exists yet.";
    }
    try {
      const content = readFileSync(filePath, "utf-8");
      return content;
    } catch (error: any) {
      return `Error reading instructions file: ${error.message}`;
    }
  },
  {
    name: "ReadClaudeMd",
    description: "Read the existing project instructions file (AGENT.md or CLAUDE.md) if it exists",
    schema: z.object({}),
  }
);

const initTools = [writeClaudeMdTool, readClaudeMdTool];

// ============ System Prompt ============

const INIT_SYSTEM_PROMPT = `You are a specialized agent for analyzing codebases and generating project instructions files (AGENT.md or CLAUDE.md).

Your task is to analyze the provided codebase context and create a comprehensive but concise instructions file that will help AI coding agents (like yourself) work effectively in this repository.

## Guidelines for Instructions File (AGENT.md / CLAUDE.md)

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

- If an AGENT.md or CLAUDE.md already exists, IMPROVE it rather than replace it entirely
- Preserve any custom sections the user may have added
- Include any Cursor rules (.cursor/rules/) or Copilot instructions (.github/copilot-instructions.md) you find
- Be specific to THIS project - don't give generic advice
- Use actual file paths and command examples from the project
- Keep it practical and actionable

After analyzing the codebase, use the WriteClaudeMd tool to write the file.`;

// ============ Middleware ============

/**
 * Middleware to inject codebase context before the model call.
 * Analyzes the codebase and prepends context to the user message.
 */
const codebaseContextMiddleware = createMiddleware({
  name: "codebase-context",
  beforeAgent: async (state: any) => {
    log.info("Init agent: analyzing codebase...");
    emitThinking("Analyzing codebase...");

    try {
      const context = collectCodebaseContext();
      const isUpdate = hasProductFile();
      const contextPrompt = formatCodebaseContextForPrompt(context);

      const userPrompt = isUpdate
        ? `Please analyze this codebase and IMPROVE the existing instructions file.

${contextPrompt}

Focus on:
1. Updating any outdated information
2. Adding missing sections
3. Preserving custom content the user may have added
4. Making it more specific and actionable

Use the WriteClaudeMd tool to write the improved file.`
        : `Please analyze this codebase and CREATE a new CLAUDE.md instructions file.

${contextPrompt}

Create a comprehensive but concise documentation file following the guidelines in your system prompt.

Use the WriteClaudeMd tool to write the file.`;

      // Replace the last user message with the enriched version
      const messages = [...(state.messages || [])];
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.constructor?.name === "HumanMessage" || lastMsg._getType?.() === "human") {
          // Prepend codebase context to the user's message
          const originalContent = typeof lastMsg.content === "string"
            ? lastMsg.content
            : String(lastMsg.content);
          const { HumanMessage } = await import("@langchain/core/messages");
          messages[messages.length - 1] = new HumanMessage(
            `${originalContent}\n\n${userPrompt}`
          );
        }
      }

      return { ...state, messages };
    } catch (error: any) {
      log.error("Codebase analysis failed", { error: error.message });
      // Continue without context injection
      return state;
    }
  },
});

// ============ Agent Creation ============

/**
 * Create the init agent using LangChain 1.0 createAgent
 */
function buildInitAgent() {
  const model = getChatModel(getAgentModel());

  return createAgent({
    model,
    tools: initTools,
    systemPrompt: INIT_SYSTEM_PROMPT,
    name: "init-agent",
    middleware: [codebaseContextMiddleware],
  });
}

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

  const isUpdate = hasProductFile();

  try {
    emitThinking("Initializing...");

    const agent = buildInitAgent();

    const result = await agent.invoke({
      messages: [
        {
          role: "user",
          content: userRequest || "Initialize project instructions file for this project",
        },
      ],
    });

    // Extract the final response
    const messages = result.messages || [];
    const lastMsg = messages[messages.length - 1];
    const content = lastMsg
      ? (typeof lastMsg.content === "string" ? lastMsg.content : String(lastMsg.content))
      : "";

    const filePath = getProductFilePath();
    const fileName = filePath.split("/").pop() || "CLAUDE.md";
    const successMessage = `Successfully ${isUpdate ? "updated" : "created"} ${fileName} with project documentation.`;

    emitResponse(successMessage);
    emitDone();

    log.info("Init agent completed", { action: isUpdate ? "updated" : "created" });

    return {
      success: true,
      message: successMessage,
      isUpdate,
    };
  } catch (error: any) {
    log.error("Init agent failed", { error: error.message });
    emitDone();
    return {
      success: false,
      message: `Failed to initialize: ${error.message}`,
      isUpdate,
    };
  }
}
