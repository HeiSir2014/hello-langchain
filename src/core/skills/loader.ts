/**
 * Skill Loader
 *
 * Loads skill configurations from markdown files in various locations:
 * - Built-in skills (hardcoded)
 * - User skills (~/.yterm/skills/ or ~/.claude/skills/)
 * - Project skills (.yterm/skills/ or .claude/skills/)
 *
 * Skills use YAML frontmatter for configuration and markdown body for system prompt.
 *
 * Directory priority (higher overrides lower):
 * 1. .claude/skills/ (project, Claude Code compatible)
 * 2. .yterm/skills/ (project)
 * 3. ~/.claude/skills/ (user, Claude Code compatible)
 * 4. ~/.yterm/skills/ (user)
 * 5. Built-in skills
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { log } from "../../logger.js";
import type { SkillConfig, SkillDirectory, SkillLocation } from "./types.js";
import { getSkillsDirPaths } from "../projectDirs.js";

// ============ Skill Directories ============

/**
 * Get all skill directories in priority order (lower index = lower priority)
 * Supports both .yterm and .claude directories for compatibility
 */
export function getSkillDirectories(): SkillDirectory[] {
  const paths = getSkillsDirPaths();

  // Convert paths to SkillDirectory format
  // Determine location based on path (user vs project)
  const home = homedir();

  return paths.map((path) => ({
    path,
    location: path.startsWith(home) ? "user" : "project",
  })) as SkillDirectory[];
}

// ============ Built-in Skills ============

/**
 * Built-in skill definitions
 */
const BUILT_IN_SKILLS: SkillConfig[] = [
  {
    name: "general-purpose",
    description: "General-purpose agent for any task",
    whenToUse: "Default skill for general software engineering tasks",
    tools: "*",
    systemPrompt: "",
    location: "built-in",
    priority: 0,
  },
  {
    name: "code-writer",
    description: "Specialized for writing and modifying code",
    whenToUse: "When the task involves writing, editing, or creating code files",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "LS", "Bash"],
    systemPrompt: `You are a specialized code writing agent.

Focus on:
- Writing clean, maintainable code
- Following existing project conventions
- Adding appropriate comments and documentation
- Handling edge cases and errors properly

Always read existing code before making changes.`,
    location: "built-in",
    color: "blue",
    priority: 1,
    tags: ["code", "development"],
  },
  {
    name: "researcher",
    description: "Research and analysis agent",
    whenToUse: "When you need to understand a codebase, research solutions, or gather information",
    tools: ["Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch"],
    systemPrompt: `You are a research and analysis agent.

Focus on:
- Understanding existing code patterns
- Finding relevant files and implementations
- Searching for solutions and best practices
- Analyzing dependencies and architecture

Do NOT modify any files - only read and analyze.`,
    location: "built-in",
    color: "green",
    readOnly: true,
    priority: 1,
    tags: ["research", "analysis"],
  },
  {
    name: "planner",
    description: "Planning and architecture agent",
    whenToUse: "When you need to plan an implementation or design a solution",
    tools: ["Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch", "SavePlan", "ReadPlan"],
    systemPrompt: `You are a software architect and planning agent.

Focus on:
- Understanding requirements and constraints
- Analyzing existing architecture
- Creating detailed implementation plans
- Identifying potential issues and solutions
- Breaking down complex tasks into manageable steps

Create structured plans with clear action items.`,
    location: "built-in",
    color: "yellow",
    readOnly: true,
    priority: 1,
    tags: ["planning", "architecture"],
  },
  {
    name: "debugger",
    description: "Debug and troubleshoot issues",
    whenToUse: "When you need to debug errors, trace issues, or troubleshoot problems",
    tools: ["Read", "Glob", "Grep", "LS", "Bash", "BashOutput"],
    systemPrompt: `You are a specialized debugging agent.

Focus on:
- Identifying root causes of errors
- Tracing execution flow and data
- Reading error logs and stack traces
- Running diagnostic commands
- Testing hypotheses systematically

Approach debugging methodically:
1. Gather information about the error
2. Form hypotheses about the cause
3. Test each hypothesis
4. Document findings
5. Suggest fixes

Use Bash for running tests, checking logs, and diagnostic commands.`,
    location: "built-in",
    color: "red",
    priority: 1,
    tags: ["debug", "troubleshoot", "fix"],
  },
  {
    name: "refactor",
    description: "Code refactoring specialist",
    whenToUse: "When you need to refactor, restructure, or improve existing code",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "LS", "Bash"],
    systemPrompt: `You are a code refactoring specialist.

Focus on:
- Improving code readability and maintainability
- Reducing code duplication (DRY principle)
- Applying appropriate design patterns
- Ensuring backward compatibility
- Maintaining existing tests

Refactoring guidelines:
1. Always read and understand the existing code first
2. Make small, incremental changes
3. Run tests after each change
4. Document significant changes
5. Preserve existing behavior

NEVER change functionality unless explicitly asked.`,
    location: "built-in",
    color: "cyan",
    priority: 1,
    tags: ["refactor", "clean", "improve"],
  },
];

// ============ Markdown Parsing ============

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const [, yaml, body] = match;
  const frontmatter: Record<string, any> = {};

  // Simple YAML parsing (key: value)
  for (const line of yaml.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Handle arrays (simple format: [a, b, c] or - a)
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1);
      frontmatter[key] = value.split(",").map((v) => v.trim().replace(/['"]/g, ""));
    } else if (value === "*") {
      frontmatter[key] = "*";
    } else if (value === "true") {
      frontmatter[key] = true;
    } else if (value === "false") {
      frontmatter[key] = false;
    } else if (!isNaN(Number(value))) {
      frontmatter[key] = Number(value);
    } else {
      frontmatter[key] = value.replace(/['"]/g, "");
    }
  }

  return { frontmatter, body: body.trim() };
}

/**
 * Load a skill from a markdown file
 */
function loadSkillFromFile(filePath: string, location: SkillLocation): SkillConfig | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    // Extract filename as default name
    const filename = filePath.split("/").pop()?.replace(/\.md$/, "") || "unknown";

    const skill: SkillConfig = {
      name: frontmatter.name || filename,
      description: frontmatter.description || "",
      whenToUse: frontmatter.whenToUse || frontmatter.when_to_use || "",
      tools: frontmatter.tools || "*",
      systemPrompt: body,
      location,
      color: frontmatter.color,
      modelName: frontmatter.model || frontmatter.modelName,
      readOnly: frontmatter.readOnly || frontmatter.read_only,
      priority: frontmatter.priority || 0,
      tags: frontmatter.tags,
    };

    log.debug("Loaded skill from file", { name: skill.name, path: filePath });
    return skill;
  } catch (error: any) {
    log.warn(`Failed to load skill from ${filePath}`, { error: error.message });
    return null;
  }
}

/**
 * Load all skills from a directory
 */
function loadSkillsFromDirectory(dir: SkillDirectory): SkillConfig[] {
  if (!existsSync(dir.path)) {
    return [];
  }

  const skills: SkillConfig[] = [];

  try {
    const entries = readdirSync(dir.path);

    for (const entry of entries) {
      const entryPath = join(dir.path, entry);
      const stat = statSync(entryPath);

      if (stat.isDirectory()) {
        // Check for SKILL.md in subdirectories
        const skillFilePath = join(entryPath, "SKILL.md");
        if (existsSync(skillFilePath)) {
          const skill = loadSkillFromFile(skillFilePath, dir.location);
          if (skill) {
            skills.push(skill);
          }
        }
      } else if (entry.endsWith(".md") && !entry.startsWith("README") && !entry.startsWith("index")) {
        // Load direct .md files (excluding README and index)
        const skill = loadSkillFromFile(entryPath, dir.location);
        if (skill) {
          skills.push(skill);
        }
      }
    }
  } catch (error: any) {
    log.debug(`Failed to read skills directory ${dir.path}`, { error: error.message });
  }

  return skills;
}

// ============ Skill Cache ============

let cachedSkills: SkillConfig[] | null = null;

/**
 * Load all available skills (cached)
 */
export function loadAllSkills(): SkillConfig[] {
  if (cachedSkills) {
    return cachedSkills;
  }

  // Start with built-in skills
  const skills = [...BUILT_IN_SKILLS];

  // Load from directories
  const directories = getSkillDirectories();
  for (const dir of directories) {
    const dirSkills = loadSkillsFromDirectory(dir);
    for (const skill of dirSkills) {
      // Override existing skill with same name
      const existingIndex = skills.findIndex((s) => s.name === skill.name);
      if (existingIndex !== -1) {
        skills[existingIndex] = skill;
        log.debug("Skill overridden", { name: skill.name, location: skill.location });
      } else {
        skills.push(skill);
      }
    }
  }

  cachedSkills = skills;
  log.info("Skills loaded", {
    total: skills.length,
    builtIn: skills.filter((s) => s.location === "built-in").length,
    user: skills.filter((s) => s.location === "user").length,
    project: skills.filter((s) => s.location === "project").length,
  });

  return skills;
}

/**
 * Clear the skill cache
 */
export function clearSkillCache(): void {
  cachedSkills = null;
}

/**
 * Get a skill by name
 */
export function getSkill(name: string): SkillConfig | null {
  const skills = loadAllSkills();
  return skills.find((s) => s.name === name) || null;
}

/**
 * Get all skill names
 */
export function getSkillNames(): string[] {
  return loadAllSkills().map((s) => s.name);
}

/**
 * Get skills matching tags
 */
export function getSkillsByTag(tag: string): SkillConfig[] {
  return loadAllSkills().filter((s) => s.tags?.includes(tag));
}

/**
 * Get read-only skills
 */
export function getReadOnlySkills(): SkillConfig[] {
  return loadAllSkills().filter((s) => s.readOnly);
}
