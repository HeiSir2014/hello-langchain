/**
 * Skill Runtime
 *
 * Provides dynamic skill execution with context injection and tool filtering.
 * Inspired by Claude Skills API concepts - programmatic knowledge that loads on demand.
 *
 * Key concepts:
 * - Skills are activated on-demand, not always loaded
 * - Skills inject specialized system prompts
 * - Skills filter available tools
 * - Skills can be composed (one skill can invoke another)
 */

import type { SkillConfig } from "./types.js";
import { getSkill, loadAllSkills } from "./loader.js";
import { log } from "../../logger.js";
import type { BaseMessage } from "@langchain/core/messages";

/**
 * Skill execution context
 */
export interface SkillContext {
  /** Conversation history */
  messages: BaseMessage[];
  /** Current working directory */
  cwd: string;
  /** User's original request */
  userRequest: string;
  /** Parent skill (if this is a nested skill call) */
  parentSkill?: string;
  /** Additional context data */
  metadata?: Record<string, unknown>;
}

/**
 * Skill execution result
 */
export interface SkillResult {
  /** Whether the skill executed successfully */
  success: boolean;
  /** Output message from the skill */
  message: string;
  /** Any artifacts produced (files, plans, etc.) */
  artifacts?: string[];
  /** Suggested next skill to invoke */
  suggestedNextSkill?: string;
}

/**
 * Active skill state
 */
interface ActiveSkillState {
  skill: SkillConfig;
  context: SkillContext;
  startTime: number;
}

/**
 * Skill Runtime - manages skill lifecycle and execution
 */
class SkillRuntime {
  private activeSkill: ActiveSkillState | null = null;
  private skillHistory: Array<{ name: string; duration: number; success: boolean }> = [];

  /**
   * Activate a skill by name
   */
  activate(skillName: string, context: SkillContext): SkillConfig | null {
    const skill = getSkill(skillName);

    if (!skill) {
      log.warn("Skill not found", { skillName });
      return null;
    }

    // Deactivate previous skill if any
    if (this.activeSkill) {
      this.deactivate(false);
    }

    this.activeSkill = {
      skill,
      context,
      startTime: Date.now(),
    };

    log.info("Skill activated", {
      name: skillName,
      location: skill.location,
      tools: skill.tools === "*" ? "all" : skill.tools.length,
    });

    return skill;
  }

  /**
   * Deactivate current skill
   */
  deactivate(success: boolean = true): void {
    if (!this.activeSkill) return;

    const duration = Date.now() - this.activeSkill.startTime;

    this.skillHistory.push({
      name: this.activeSkill.skill.name,
      duration,
      success,
    });

    log.info("Skill deactivated", {
      name: this.activeSkill.skill.name,
      duration,
      success,
    });

    this.activeSkill = null;
  }

  /**
   * Get currently active skill
   */
  getActiveSkill(): SkillConfig | null {
    return this.activeSkill?.skill || null;
  }

  /**
   * Get active skill context
   */
  getActiveContext(): SkillContext | null {
    return this.activeSkill?.context || null;
  }

  /**
   * Check if a skill is currently active
   */
  isActive(): boolean {
    return this.activeSkill !== null;
  }

  /**
   * Get the system prompt for active skill
   */
  getActiveSystemPrompt(): string {
    if (!this.activeSkill) return "";

    const skill = this.activeSkill.skill;
    const context = this.activeSkill.context;

    let prompt = skill.systemPrompt || "";

    // Add skill metadata to prompt
    if (prompt) {
      prompt = `# Active Skill: ${skill.name}
${skill.description}

${prompt}

---
`;
    }

    // Add context info
    if (context.userRequest) {
      prompt += `\nUser's request: ${context.userRequest}\n`;
    }

    return prompt;
  }

  /**
   * Get allowed tool names for active skill
   */
  getAllowedTools(): string[] | "*" {
    if (!this.activeSkill) return "*";
    return this.activeSkill.skill.tools;
  }

  /**
   * Check if a tool is allowed by active skill
   */
  isToolAllowed(toolName: string): boolean {
    if (!this.activeSkill) return true;

    const tools = this.activeSkill.skill.tools;
    if (tools === "*") return true;

    return tools.includes(toolName);
  }

  /**
   * Get skill execution history
   */
  getHistory(): Array<{ name: string; duration: number; success: boolean }> {
    return [...this.skillHistory];
  }

  /**
   * Clear skill history
   */
  clearHistory(): void {
    this.skillHistory = [];
  }

  /**
   * Get suggested skill for a user request
   * Uses simple keyword matching - could be enhanced with LLM
   */
  suggestSkill(userRequest: string): SkillConfig | null {
    const skills = loadAllSkills();
    const request = userRequest.toLowerCase();

    // Priority-sorted skills
    const sortedSkills = [...skills].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const skill of sortedSkills) {
      // Check if request matches skill's whenToUse
      const whenToUse = skill.whenToUse.toLowerCase();
      const keywords = whenToUse.split(/\s+/).filter((w) => w.length > 3);

      for (const keyword of keywords) {
        if (request.includes(keyword)) {
          return skill;
        }
      }

      // Check tags
      if (skill.tags) {
        for (const tag of skill.tags) {
          if (request.includes(tag.toLowerCase())) {
            return skill;
          }
        }
      }
    }

    // Default to general-purpose
    return getSkill("general-purpose");
  }
}

// Singleton instance
let runtimeInstance: SkillRuntime | null = null;

/**
 * Get the skill runtime instance
 */
export function getSkillRuntime(): SkillRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new SkillRuntime();
  }
  return runtimeInstance;
}

/**
 * Reset the skill runtime (for testing)
 */
export function resetSkillRuntime(): void {
  if (runtimeInstance) {
    runtimeInstance.deactivate(false);
    runtimeInstance.clearHistory();
  }
  runtimeInstance = null;
}

/**
 * Build skill invocation prompt
 * Creates a prompt that instructs the agent to operate within skill constraints
 */
export function buildSkillPrompt(skill: SkillConfig, userRequest: string): string {
  const toolsInfo =
    skill.tools === "*"
      ? "You have access to all available tools."
      : `You have access to the following tools only: ${skill.tools.join(", ")}`;

  return `# Skill Activated: ${skill.name}

## Description
${skill.description}

## Guidelines
${skill.whenToUse}

## Tool Access
${toolsInfo}

${skill.readOnly ? "**This is a read-only skill. You CANNOT modify any files.**\n" : ""}

## Skill Instructions
${skill.systemPrompt}

---

## User Request
${userRequest}

Please complete this request following the skill guidelines above.`;
}

/**
 * Format skill list for display
 */
export function formatSkillList(): string {
  const skills = loadAllSkills();

  const lines = ["# Available Skills\n"];

  const byLocation = {
    "built-in": skills.filter((s) => s.location === "built-in"),
    user: skills.filter((s) => s.location === "user"),
    project: skills.filter((s) => s.location === "project"),
  };

  for (const [location, locationSkills] of Object.entries(byLocation)) {
    if (locationSkills.length === 0) continue;

    lines.push(`## ${location.charAt(0).toUpperCase() + location.slice(1)} Skills\n`);

    for (const skill of locationSkills) {
      const tags = skill.tags ? ` [${skill.tags.join(", ")}]` : "";
      const readOnly = skill.readOnly ? " (read-only)" : "";
      lines.push(`- **${skill.name}**${readOnly}: ${skill.description}${tags}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
