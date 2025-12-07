/**
 * Skills Module
 *
 * Provides skill management for specialized agent configurations.
 * Skills can be defined via markdown files or built-in configurations.
 *
 * Key concepts (inspired by Claude Skills API):
 * - Skills are programmatic knowledge that loads on demand
 * - Skills filter available tools
 * - Skills inject specialized system prompts
 * - Skills can be activated/deactivated at runtime
 */

export type { SkillConfig, SkillLocation, SkillDirectory } from "./types.js";
export { BUILT_IN_SKILLS } from "./types.js";

export {
  loadAllSkills,
  clearSkillCache,
  getSkill,
  getSkillNames,
  getSkillsByTag,
  getReadOnlySkills,
  getSkillDirectories,
} from "./loader.js";

export {
  getSkillRuntime,
  resetSkillRuntime,
  buildSkillPrompt,
  formatSkillList,
  type SkillContext,
  type SkillResult,
} from "./runtime.js";

import { getSkill } from "./loader.js";
import { getSkillRuntime } from "./runtime.js";
import { allTools } from "../tools/index.js";
import type { SkillConfig } from "./types.js";

/**
 * Get tools allowed for a specific skill
 */
export function getToolsForSkill(skillName: string) {
  const skill = getSkill(skillName);

  if (!skill) {
    // Default: all tools
    return allTools;
  }

  if (skill.tools === "*") {
    return allTools;
  }

  // Filter to allowed tools
  return allTools.filter((t) => (skill.tools as string[]).includes(t.name));
}

/**
 * Get tools allowed for the currently active skill
 * Returns all tools if no skill is active
 */
export function getToolsForActiveSkill() {
  const runtime = getSkillRuntime();
  const activeSkill = runtime.getActiveSkill();

  if (!activeSkill) {
    return allTools;
  }

  if (activeSkill.tools === "*") {
    return allTools;
  }

  return allTools.filter((t) => (activeSkill.tools as string[]).includes(t.name));
}

/**
 * Check if a skill allows a specific tool
 */
export function skillAllowsTool(skill: SkillConfig, toolName: string): boolean {
  if (skill.tools === "*") {
    return true;
  }

  return (skill.tools as string[]).includes(toolName);
}

/**
 * Get the system prompt extension for a skill
 */
export function getSkillSystemPrompt(skillName: string): string | null {
  const skill = getSkill(skillName);
  return skill?.systemPrompt || null;
}

/**
 * Get the system prompt for the currently active skill
 */
export function getActiveSkillSystemPrompt(): string | null {
  const runtime = getSkillRuntime();
  return runtime.getActiveSystemPrompt() || null;
}
