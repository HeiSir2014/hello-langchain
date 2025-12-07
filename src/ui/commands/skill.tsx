/**
 * Skill command
 *
 * Invoke and manage skills with interactive selection:
 * - /skill - Show skill selection UI
 * - /skill <name> - Activate a skill directly
 * - /skill off - Deactivate current skill
 * - /skill status - Show current skill status
 */
import * as React from "react";
import type { Command } from "./index.js";
import { loadAllSkills, getSkill } from "../../core/skills/loader.js";
import { getSkillRuntime } from "../../core/skills/runtime.js";
import { SkillSelect } from "../components/SkillSelect.js";

const skill: Command = {
  type: "local-jsx",
  name: "skill",
  description: "List, activate, or deactivate skills",
  isEnabled: true,
  isHidden: false,
  aliases: ["sk"],

  async call(args, onDone, context) {
    const runtime = getSkillRuntime();
    const trimmedArgs = args.trim().toLowerCase();

    // Handle direct commands (off, status, or skill name)
    if (trimmedArgs) {
      // Deactivate skill
      if (trimmedArgs === "off" || trimmedArgs === "deactivate") {
        const activeSkill = runtime.getActiveSkill();
        if (activeSkill) {
          runtime.deactivate(true);
          onDone(`Skill "${activeSkill.name}" deactivated.`);
        } else {
          onDone("No skill is currently active.");
        }
        return null;
      }

      // Show current skill status
      if (trimmedArgs === "status" || trimmedArgs === "current") {
        const activeSkill = runtime.getActiveSkill();
        if (activeSkill) {
          const tools =
            activeSkill.tools === "*" ? "all" : activeSkill.tools.join(", ");
          onDone(
            `Active skill: ${activeSkill.name}\nDescription: ${activeSkill.description}\nTools: ${tools}`
          );
        } else {
          onDone("No skill is currently active.");
        }
        return null;
      }

      // Try to activate skill by name directly
      const skillName = trimmedArgs;
      const skillConfig = getSkill(skillName);

      if (skillConfig) {
        const activatedSkill = runtime.activate(skillName, {
          messages: [],
          cwd: process.cwd(),
          userRequest: "",
        });

        if (activatedSkill) {
          const tools =
            activatedSkill.tools === "*"
              ? "all"
              : activatedSkill.tools.join(", ");
          onDone(
            `Skill "${activatedSkill.name}" activated.\n${activatedSkill.description}\nTools: ${tools}`
          );
        } else {
          onDone("Failed to activate skill.");
        }
        return null;
      }

      // Try fuzzy match
      const allSkills = loadAllSkills();
      const matches = allSkills.filter(
        (s) =>
          s.name.toLowerCase().includes(skillName) ||
          s.tags?.some((t) => t.toLowerCase().includes(skillName))
      );

      if (matches.length === 1) {
        const activatedSkill = runtime.activate(matches[0].name, {
          messages: [],
          cwd: process.cwd(),
          userRequest: "",
        });

        if (activatedSkill) {
          onDone(
            `Skill "${activatedSkill.name}" activated.\n${activatedSkill.description}`
          );
        } else {
          onDone("Failed to activate skill.");
        }
        return null;
      } else if (matches.length > 1) {
        onDone(
          `Multiple skills match "${skillName}":\n${matches.map((s) => `  - ${s.name}`).join("\n")}\nPlease be more specific.`
        );
        return null;
      } else {
        onDone(`Skill "${skillName}" not found. Use /skill to see available skills.`);
        return null;
      }
    }

    // No args - show interactive selection UI
    const allSkills = loadAllSkills();
    const activeSkill = runtime.getActiveSkill();

    const handleSelect = (skillName: string) => {
      const activatedSkill = runtime.activate(skillName, {
        messages: [],
        cwd: process.cwd(),
        userRequest: "",
      });

      if (activatedSkill) {
        const tools =
          activatedSkill.tools === "*"
            ? "all"
            : activatedSkill.tools.join(", ");
        onDone(
          `Skill "${activatedSkill.name}" activated.\n${activatedSkill.description}\nTools: ${tools}`
        );
      } else {
        onDone("Failed to activate skill.");
      }
    };

    const handleDeactivate = () => {
      const currentSkill = runtime.getActiveSkill();
      if (currentSkill) {
        runtime.deactivate(true);
        onDone(`Skill "${currentSkill.name}" deactivated.`);
      } else {
        onDone("No skill is currently active.");
      }
    };

    const handleClose = () => {
      onDone();
    };

    return (
      <SkillSelect
        skills={allSkills}
        activeSkillName={activeSkill?.name}
        onSelect={handleSelect}
        onDeactivate={handleDeactivate}
        onClose={handleClose}
      />
    );
  },

  userFacingName() {
    return "skill";
  },
};

export default skill;
