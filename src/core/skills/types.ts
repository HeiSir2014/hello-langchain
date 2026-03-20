/**
 * Skill Types
 *
 * Skills are specialized agent configurations that can be loaded from
 * markdown files. They define tool restrictions, system prompts, and
 * other capabilities.
 */

/**
 * Location where the skill was defined
 */
export type SkillLocation = "built-in" | "user" | "project";

/**
 * Runtime requirements for a skill (OpenClaw-inspired)
 */
export interface SkillRequirements {
  /** Required environment variables (e.g. ["OPENAI_API_KEY"]) */
  env?: string[];
  /** Required binaries on PATH (e.g. ["git", "docker"]) */
  bins?: string[];
}

/**
 * Skill configuration loaded from markdown frontmatter
 */
export interface SkillConfig {
  /** Unique identifier for the skill */
  name: string;

  /** Human-readable description */
  description: string;

  /** When to use this skill (guidance for agent selection) */
  whenToUse: string;

  /** Tool permissions: '*' for all, or specific tool names */
  tools: string[] | "*";

  /** System prompt content (from markdown body) */
  systemPrompt: string;

  /** Where the skill was loaded from */
  location: SkillLocation;

  /** Optional display color in UI */
  color?: string;

  /** Optional model override */
  modelName?: string;

  /** Whether this skill is read-only (can't modify files) */
  readOnly?: boolean;

  /** Priority for skill selection (higher = more preferred) */
  priority?: number;

  /** Tags for categorization */
  tags?: string[];

  // === OpenClaw-inspired metadata ===

  /** Runtime requirements (env vars, binaries) */
  requires?: SkillRequirements;

  /** Always activate this skill (auto-inject into context) */
  always?: boolean;

  /** Skill is user-invocable via slash command (e.g. /skill-name) */
  userInvocable?: boolean;

  /** Prevent the model from activating this skill automatically */
  disableModelInvocation?: boolean;
}

/**
 * Skill directory configuration
 */
export interface SkillDirectory {
  path: string;
  location: SkillLocation;
}

/**
 * Built-in skill names
 */
export const BUILT_IN_SKILLS = [
  "general-purpose",
  "code-writer",
  "researcher",
  "planner",
  "debugger",
  "refactor",
] as const;

export type BuiltInSkillName = typeof BUILT_IN_SKILLS[number];
