/**
 * Prompt Sections 单元测试
 *
 * 验证每个 section factory 的输出和 layer 归属
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
  // ============ Static Sections (layer: "system") ============

  describe("static sections — layer: system", () => {
    const staticFactories = [
      { name: "identity", factory: buildIdentitySection },
      { name: "safety", factory: buildSafetySection },
      { name: "style", factory: buildStyleSection },
      { name: "task-management", factory: buildTaskManagementSection },
      { name: "tool-policy", factory: buildToolPolicySection },
      { name: "environment", factory: buildEnvironmentSection },
    ];

    test.each(staticFactories)("$name has layer: system", ({ factory }) => {
      const section = factory();
      expect(section.layer).toBe("system");
    });

    test.each(staticFactories)("$name content is stable (cache-friendly)", ({ factory }) => {
      const a = factory();
      const b = factory();
      expect(a.content).toBe(b.content);
    });

    test.each(staticFactories)("$name has required properties", ({ factory }) => {
      const section = factory();
      expect(section.id).toBeTruthy();
      expect(section.tag).toBeTruthy();
      expect(section.title).toBeTruthy();
      expect(section.content).toBeTruthy();
      expect(section.priority).toBeTruthy();
      expect(typeof section.weight).toBe("number");
      expect(section.enabled).toBe(true);
    });
  });

  // ============ Identity ============

  describe("buildIdentitySection", () => {
    test("包含 YTerm 和 LangGraph", () => {
      const section = buildIdentitySection();
      expect(section.content).toContain("YTerm");
      expect(section.content).toContain("LangGraph");
    });

    test("priority 为 critical", () => {
      expect(buildIdentitySection().priority).toBe("critical");
    });
  });

  // ============ Safety ============

  describe("buildSafetySection", () => {
    test("包含 URL 安全约束", () => {
      expect(buildSafetySection().content).toContain("NEVER generate or guess URLs");
    });

    test("包含安全漏洞防护", () => {
      const content = buildSafetySection().content;
      expect(content).toContain("XSS");
      expect(content).toContain("SQL injection");
    });

    test("包含恶意代码分析规则", () => {
      expect(buildSafetySection().content).toContain("malware");
    });

    test("priority 为 critical", () => {
      expect(buildSafetySection().priority).toBe("critical");
    });
  });

  // ============ Style ============

  describe("buildStyleSection", () => {
    test("包含输出格式规则", () => {
      const content = buildStyleSection().content;
      expect(content).toContain("markdown");
      expect(content).toContain("concise");
    });
  });

  // ============ Task Management ============

  describe("buildTaskManagementSection", () => {
    test("包含 TodoWrite 指导", () => {
      expect(buildTaskManagementSection().content).toContain("TodoWrite");
    });

    test("包含代码审查规则", () => {
      expect(buildTaskManagementSection().content).toContain("NEVER propose changes to code you haven't read");
    });
  });

  // ============ Tool Policy ============

  describe("buildToolPolicySection", () => {
    test("包含并发调用和工具替代规则", () => {
      const content = buildToolPolicySection().content;
      expect(content).toContain("parallel");
      expect(content).toContain("Read");
      expect(content).toContain("Bash");
    });
  });

  // ============ Environment ============

  describe("buildEnvironmentSection", () => {
    test("包含运行时信息", () => {
      const content = buildEnvironmentSection().content;
      expect(content).toContain(process.cwd());
      expect(content).toContain(process.platform);
    });

    test("包含日期", () => {
      const today = new Date().toISOString().split("T")[0];
      expect(buildEnvironmentSection().content).toContain(today);
    });

    test("包含 git 状态", () => {
      expect(buildEnvironmentSection().content).toMatch(/Branch:|Git status unavailable/);
    });
  });

  // ============ Dynamic Sections (layer: "message") ============

  describe("dynamic sections — layer: message", () => {
    test("active-skill 无激活时返回 null", () => {
      expect(buildActiveSkillSection()).toBeNull();
    });

    test("plan-mode 非 plan mode 时返回 null", () => {
      expect(buildPlanModeSection()).toBeNull();
    });

    test("anti-hallucination 无映射时返回 null", () => {
      expect(buildAntiHallucinationSection()).toBeNull();
    });
  });

  // ============ Anti-Hallucination Details ============

  describe("buildAntiHallucinationSection", () => {
    test("有映射时 layer 为 message", () => {
      const { getAntiHallucinationPipeline } = require("../../middleware/index.js");
      const pipeline = getAntiHallucinationPipeline();
      pipeline.processToolResult(
        "See https://example.com/api/v1/docs?section=getting-started for docs",
        "WebSearch"
      );

      const section = buildAntiHallucinationSection();
      expect(section).not.toBeNull();
      expect(section!.layer).toBe("message");
      expect(section!.tag).toBe("structured-id-references");
      expect(section!.priority).toBe("dynamic");

      pipeline.reset();
    });

    test("包含完整的占位符使用指令", () => {
      const { getAntiHallucinationPipeline } = require("../../middleware/index.js");
      const pipeline = getAntiHallucinationPipeline();
      pipeline.processToolResult(
        "See https://example.com/api/v1/docs?section=getting-started for docs",
        "WebSearch"
      );

      const section = buildAntiHallucinationSection()!;

      // 5 条规则
      expect(section.content).toContain("ALWAYS use the REF-N placeholder");
      expect(section.content).toContain("NEVER try to reconstruct");
      expect(section.content).toContain("automatically resolved");

      // 示例
      expect(section.content).toContain("CORRECT:");
      expect(section.content).toContain("WRONG:");

      // 参考表
      expect(section.content).toContain("REF-1");
      expect(section.content).toContain("<reference-map>");

      pipeline.reset();
    });

    test("指令包含 5 条具体规则", () => {
      const { getAntiHallucinationPipeline } = require("../../middleware/index.js");
      const pipeline = getAntiHallucinationPipeline();
      pipeline.processToolResult(
        "UUID: 550e8400-e29b-41d4-a716-446655440000",
        "Bash"
      );

      const section = buildAntiHallucinationSection()!;
      expect(section.content).toContain("1.");
      expect(section.content).toContain("2.");
      expect(section.content).toContain("3.");
      expect(section.content).toContain("4.");
      expect(section.content).toContain("5.");

      pipeline.reset();
    });
  });
});
