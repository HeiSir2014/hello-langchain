/**
 * Plan Mode Tools
 *
 * Tools for plan mode functionality:
 * - ExitPlanMode: Exit plan mode and return to normal mode
 * - SavePlan: Save a plan to a markdown file
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { log } from "../../logger.js";
import { setPermissionMode, getPermissionMode } from "../settings.js";

// Store the previous mode for restoration
let previousModeBeforePlan: string | null = null;

/**
 * Set the previous mode to restore when exiting plan mode
 */
export function setPreviousModeBeforePlan(mode: string): void {
  previousModeBeforePlan = mode;
}

/**
 * Get the previous mode
 */
export function getPreviousModeBeforePlan(): string | null {
  return previousModeBeforePlan;
}

/**
 * ExitPlanMode Tool
 *
 * Exits plan mode and restores the previous permission mode.
 * Use this when research and planning is complete and ready for implementation.
 */
export const ExitPlanMode = tool(
  async ({ planSummary, proceedWithImplementation }: {
    planSummary?: string;
    proceedWithImplementation?: boolean;
  }) => {
    const currentMode = getPermissionMode();

    if (currentMode !== "plan") {
      return "Not currently in plan mode. No action needed.";
    }

    // Restore previous mode
    const restoreMode = previousModeBeforePlan || "default";
    setPermissionMode(restoreMode as any);
    previousModeBeforePlan = null;

    log.info("Exited plan mode", {
      restoredMode: restoreMode,
      hasSummary: !!planSummary,
      proceedWithImplementation,
    });

    const summary = planSummary ? `\n\nPlan Summary: ${planSummary}` : "";
    const nextStep = proceedWithImplementation
      ? "\n\nReady to proceed with implementation. You can now use write tools."
      : "\n\nPlan mode exited. Use /plan or Shift+Tab to re-enter when needed.";

    return `Successfully exited plan mode. Restored to "${restoreMode}" mode.${summary}${nextStep}`;
  },
  {
    name: "ExitPlanMode",
    description: `Exit plan mode and return to normal mode with full tool access.

Use this tool when:
1. You have completed researching and analyzing the codebase
2. You have created a detailed implementation plan
3. The user wants to exit plan mode
4. You are ready to start implementing changes

After exiting, you will have access to write tools (Write, Edit, Bash, etc.)`,
    schema: z.object({
      planSummary: z.string().optional().describe("Brief summary of what was planned"),
      proceedWithImplementation: z.boolean().optional().describe("Whether to immediately proceed with implementation"),
    }),
  }
);

/**
 * SavePlan Tool
 *
 * Saves a plan to a markdown file for later reference.
 */
export const SavePlan = tool(
  async ({ content, filename }: { content: string; filename?: string }) => {
    const planFile = filename || ".yterm/plan.md";
    const fullPath = join(process.cwd(), planFile);

    try {
      // Ensure directory exists
      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(fullPath, content, "utf-8");
      log.info("Plan saved", { path: fullPath });

      return `Plan saved to ${planFile}. You can reference this plan during implementation.`;
    } catch (error: any) {
      log.error("Failed to save plan", { error: error.message });
      return `Error saving plan: ${error.message}`;
    }
  },
  {
    name: "SavePlan",
    description: `Save the generated implementation plan to a markdown file.

Use this to:
1. Preserve your research and planning for later reference
2. Share the plan with the user or team
3. Create a checklist for implementation

The default location is .yterm/plan.md in the project root.`,
    schema: z.object({
      content: z.string().describe("The plan content in markdown format"),
      filename: z.string().optional().describe("Custom filename (default: .yterm/plan.md)"),
    }),
  }
);

/**
 * ReadPlan Tool
 *
 * Reads an existing plan file.
 */
export const ReadPlan = tool(
  async ({ filename }: { filename?: string }) => {
    const planFile = filename || ".yterm/plan.md";
    const fullPath = join(process.cwd(), planFile);

    try {
      if (!existsSync(fullPath)) {
        return `No plan file found at ${planFile}. Use SavePlan to create one.`;
      }

      const { readFileSync } = await import("fs");
      const content = readFileSync(fullPath, "utf-8");
      return content;
    } catch (error: any) {
      log.error("Failed to read plan", { error: error.message });
      return `Error reading plan: ${error.message}`;
    }
  },
  {
    name: "ReadPlan",
    description: "Read an existing plan file",
    schema: z.object({
      filename: z.string().optional().describe("Plan filename (default: .yterm/plan.md)"),
    }),
  }
);
