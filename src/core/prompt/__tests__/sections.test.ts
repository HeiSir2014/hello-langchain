/**
 * Prompt Sections 单元测试
 *
 * 测试每个 section factory 的输出格式和内容
 */

import { describe, test, expect } from "bun:test";
import {
  buildIdentitySection,
  buildSafetySection,
  buildStyleSection,
  buildTaskManagementSection,
  buildToolPolicySection,
  buildEnvironmentSection,
  buildActiveSkillSection,
  buildPlanModeSection,
  buildAntiHallucinationSection,
} from "../sections.js";

describe("Section Factories", () => {
  // ============ Identity ============

  describe("buildIdentitySection", () => {
    test("返回正确的 section 结构", () => {
      const section = buildIdentitySection();

      expect(section.id).toBe("identity");
      expect(section.tag).toBe("identity");
      expect(section.priority).toBe("critical");
      expect(section.enabled).toBe(true);
      expect(section.content).toContain("YTerm");
      expect(section.content).toContain("LangGraph");
    });

    test("内容稳定（cache-friendly）", () => {
      const a = buildIdentitySection();
      const b = buildIdentitySection();
      expect(a.content).toBe(b.content);
    });
  });

  // ============ Safety ============

  describe("buildSafetySection", () => {
    test("包含 URL 安全约束", () => {
      const section = buildSafetySection();
      expect(section.content).toContain("NEVER generate or guess URLs");
    });

    test("包含安全漏洞防护", () => {
      const section = buildSafetySection();
      expect(section.content).toContain("XSS");
      expect(section.content).toContain("SQL injection");
    });

    test("包含恶意代码分析规则", () => {
      const section = buildSafetySection();
      expect(section.content).toContain("malware");
    });

    test("priority 为 critical", () => {
      expect(buildSafetySection().priority).toBe("critical");
    });
  });

  // ============ Style ============

  describe("buildStyleSection", () => {
    test("包含输出格式规则", () => {
      const section = buildStyleSection();
      expect(section.content).toContain("markdown");
      expect(section.content).toContain("concise");
    });

    test("priority 为 high", () => {
      expect(buildStyleSection().priority).toBe("high");
    });
  });

  // ============ Task Management ============

  describe("buildTaskManagementSection", () => {
    test("包含 TodoWrite 指导", () => {
      const section = buildTaskManagementSection();
      expect(section.content).toContain("TodoWrite");
    });

    test("包含代码审查规则", () => {
      const section = buildTaskManagementSection();
      expect(section.content).toContain("NEVER propose changes to code you haven't read");
    });
  });

  // ============ Tool Policy ============

  describe("buildToolPolicySection", () => {
    test("包含并发调用规则", () => {
      const section = buildToolPolicySection();
      expect(section.content).toContain("parallel");
    });

    test("包含工具替代规则", () => {
      const section = buildToolPolicySection();
      expect(section.content).toContain("Read");
      expect(section.content).toContain("Edit");
      expect(section.content).toContain("Bash");
    });
  });

  // ============ Environment ============

  describe("buildEnvironmentSection", () => {
    test("包含运行时信息", () => {
      const section = buildEnvironmentSection();
      expect(section.content).toContain(process.cwd());
      expect(section.content).toContain(process.platform);
    });

    test("包含日期", () => {
      const section = buildEnvironmentSection();
      const today = new Date().toISOString().split("T")[0];
      expect(section.content).toContain(today);
    });

    test("包含 git 状态", () => {
      const section = buildEnvironmentSection();
      // 在 git repo 中应该包含分支信息
      expect(section.content).toMatch(/Branch:|Git status unavailable/);
    });

    test("priority 为 medium", () => {
      expect(buildEnvironmentSection().priority).toBe("medium");
    });
  });

  // ============ Active Skill ============

  describe("buildActiveSkillSection", () => {
    test("无活跃技能时返回 null", () => {
      const section = buildActiveSkillSection();
      // 默认没有活跃技能
      expect(section).toBeNull();
    });
  });

  // ============ Plan Mode ============

  describe("buildPlanModeSection", () => {
    test("非 plan mode 时返回 null", () => {
      // 默认不是 plan mode
      const section = buildPlanModeSection();
      expect(section).toBeNull();
    });
  });

  // ============ Anti-Hallucination ============

  describe("buildAntiHallucinationSection", () => {
    test("无映射时返回 null", () => {
      const section = buildAntiHallucinationSection();
      expect(section).toBeNull();
    });

    test("有映射时返回详细指令", () => {
      const { getAntiHallucinationPipeline } = require("../../middleware/index.js");
      const pipeline = getAntiHallucinationPipeline();
      pipeline.processToolResult(
        "See https://example.com/api/v1/docs?section=getting-started for docs",
        "WebSearch"
      );

      const section = buildAntiHallucinationSection();

      expect(section).not.toBeNull();
      expect(section!.id).toBe("anti-hallucination");
      expect(section!.tag).toBe("structured-id-references");
      expect(section!.priority).toBe("dynamic");

      // 关键指令
      expect(section!.content).toContain("ALWAYS use the REF-N placeholder");
      expect(section!.content).toContain("NEVER try to reconstruct");
      expect(section!.content).toContain("automatically resolved");

      // 示例
      expect(section!.content).toContain("CORRECT:");
      expect(section!.content).toContain("WRONG:");

      // 参考表
      expect(section!.content).toContain("REF-1");
      expect(section!.content).toContain("<reference-map>");

      // 清理
      pipeline.reset();
    });

    test("指令包含具体的使用规则", () => {
      const { getAntiHallucinationPipeline } = require("../../middleware/index.js");
      const pipeline = getAntiHallucinationPipeline();
      pipeline.processToolResult(
        "UUID: 550e8400-e29b-41d4-a716-446655440000",
        "Bash"
      );

      const section = buildAntiHallucinationSection()!;

      // 5 条规则
      expect(section.content).toContain("1.");
      expect(section.content).toContain("2.");
      expect(section.content).toContain("3.");
      expect(section.content).toContain("4.");
      expect(section.content).toContain("5.");

      pipeline.reset();
    });
  });

  // ============ Section 属性一致性 ============

  describe("section property consistency", () => {
    const factories = [
      buildIdentitySection,
      buildSafetySection,
      buildStyleSection,
      buildTaskManagementSection,
      buildToolPolicySection,
      buildEnvironmentSection,
    ];

    test("所有 section 都有必需属性", () => {
      for (const factory of factories) {
        const section = factory();
        expect(section.id).toBeTruthy();
        expect(section.tag).toBeTruthy();
        expect(section.title).toBeTruthy();
        expect(section.content).toBeTruthy();
        expect(section.priority).toBeTruthy();
        expect(typeof section.weight).toBe("number");
        expect(typeof section.enabled).toBe("boolean");
      }
    });

    test("所有 section 的 id 和 tag 不为空", () => {
      for (const factory of factories) {
        const section = factory();
        expect(section.id.length).toBeGreaterThan(0);
        expect(section.tag.length).toBeGreaterThan(0);
      }
    });
  });
});
