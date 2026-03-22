/**
 * Skill Loader Tests
 *
 * Covers:
 * - Built-in skill loading
 * - Skill cache management
 * - Skill lookup by name, tag
 * - Skill directory discovery
 * - Read-only skill filtering
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  loadAllSkills,
  clearSkillCache,
  getSkill,
  getSkillNames,
  getSkillsByTag,
  getReadOnlySkills,
} from "../loader.js";
import { BUILT_IN_SKILLS } from "../types.js";

describe("loadAllSkills", () => {
  beforeEach(() => {
    clearSkillCache();
  });

  test("loads at least built-in skills", () => {
    const skills = loadAllSkills();
    // BUILT_IN_SKILLS is a string array of names
    expect(skills.length).toBeGreaterThanOrEqual(BUILT_IN_SKILLS.length);
  });

  test("includes general-purpose skill", () => {
    const skills = loadAllSkills();
    const gp = skills.find(s => s.name === "general-purpose");
    expect(gp).toBeDefined();
    expect(gp!.tools).toBe("*");
    expect(gp!.location).toBe("built-in");
  });

  test("includes code-writer skill", () => {
    const skills = loadAllSkills();
    const cw = skills.find(s => s.name === "code-writer");
    expect(cw).toBeDefined();
    expect(cw!.tools).toContain("Write");
    expect(cw!.tools).toContain("Edit");
    expect(cw!.color).toBe("blue");
  });

  test("includes researcher skill", () => {
    const skills = loadAllSkills();
    const r = skills.find(s => s.name === "researcher");
    expect(r).toBeDefined();
    expect(r!.readOnly).toBe(true);
    expect(r!.color).toBe("green");
  });

  test("caches results on subsequent calls", () => {
    const first = loadAllSkills();
    const second = loadAllSkills();
    // Same reference means cache was used
    expect(first).toBe(second);
  });

  test("cache is cleared by clearSkillCache", () => {
    const first = loadAllSkills();
    clearSkillCache();
    const second = loadAllSkills();
    expect(first).not.toBe(second);
    // But same content
    expect(first.length).toBe(second.length);
  });
});

describe("getSkill", () => {
  beforeEach(() => {
    clearSkillCache();
  });

  test("returns skill by name", () => {
    const skill = getSkill("general-purpose");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("general-purpose");
  });

  test("returns null for non-existent skill", () => {
    const skill = getSkill("nonexistent-skill");
    expect(skill).toBeNull();
  });

  test("returns planner skill", () => {
    const skill = getSkill("planner");
    expect(skill).not.toBeNull();
    expect(skill!.readOnly).toBe(true);
    expect(skill!.tags).toContain("planning");
  });

  test("returns debugger skill", () => {
    const skill = getSkill("debugger");
    expect(skill).not.toBeNull();
    expect(skill!.color).toBe("red");
    expect(skill!.tags).toContain("debug");
  });
});

describe("getSkillNames", () => {
  beforeEach(() => {
    clearSkillCache();
  });

  test("returns array of skill names", () => {
    const names = getSkillNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(0);
  });

  test("includes all built-in skill names", () => {
    const names = getSkillNames();
    for (const skillName of BUILT_IN_SKILLS) {
      expect(names).toContain(skillName);
    }
  });
});

describe("getSkillsByTag", () => {
  beforeEach(() => {
    clearSkillCache();
  });

  test("returns skills matching tag", () => {
    const codeSkills = getSkillsByTag("code");
    expect(codeSkills.length).toBeGreaterThan(0);
    for (const skill of codeSkills) {
      expect(skill.tags).toContain("code");
    }
  });

  test("returns empty array for unknown tag", () => {
    const skills = getSkillsByTag("nonexistent-tag");
    expect(skills).toEqual([]);
  });

  test("debug tag returns debugger skill", () => {
    const skills = getSkillsByTag("debug");
    expect(skills.length).toBeGreaterThan(0);
    expect(skills[0].name).toBe("debugger");
  });
});

describe("getReadOnlySkills", () => {
  beforeEach(() => {
    clearSkillCache();
  });

  test("returns only read-only skills", () => {
    const readOnlySkills = getReadOnlySkills();
    for (const skill of readOnlySkills) {
      expect(skill.readOnly).toBe(true);
    }
  });

  test("includes researcher and planner", () => {
    const readOnlySkills = getReadOnlySkills();
    const names = readOnlySkills.map(s => s.name);
    expect(names).toContain("researcher");
    expect(names).toContain("planner");
  });

  test("does not include code-writer", () => {
    const readOnlySkills = getReadOnlySkills();
    const names = readOnlySkills.map(s => s.name);
    expect(names).not.toContain("code-writer");
  });
});
