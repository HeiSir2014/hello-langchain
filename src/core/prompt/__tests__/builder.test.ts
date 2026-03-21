/**
 * Prompt Builder 测试
 *
 * 覆盖：
 * - Section 注册/注销
 * - 优先级排序
 * - XML 标签包裹
 * - Section 禁用/启用/覆盖
 * - 防幻觉 section 条件注入
 * - 全局实例
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  PromptBuilder,
  getPromptBuilder,
  resetPromptBuilder,
} from "../builder.js";
import type { PromptSection } from "../types.js";

describe("PromptBuilder", () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    resetPromptBuilder();
    builder = new PromptBuilder();
  });

  // ============ 基本构建 ============

  describe("basic build", () => {
    test("构建包含所有默认 sections", () => {
      const prompt = builder.build();

      // 应该包含各核心 section 的内容
      expect(prompt).toContain("<identity>");
      expect(prompt).toContain("</identity>");
      expect(prompt).toContain("<safety>");
      expect(prompt).toContain("</safety>");
      expect(prompt).toContain("<style>");
      expect(prompt).toContain("<task-management>");
      expect(prompt).toContain("<tool-policy>");
      expect(prompt).toContain("<env>");
    });

    test("默认注册的 section IDs", () => {
      const ids = builder.getRegisteredSections();

      expect(ids).toContain("identity");
      expect(ids).toContain("safety");
      expect(ids).toContain("style");
      expect(ids).toContain("task-management");
      expect(ids).toContain("tool-policy");
      expect(ids).toContain("environment");
      expect(ids).toContain("active-skill");
      expect(ids).toContain("plan-mode");
      expect(ids).toContain("anti-hallucination");
    });

    test("非空 prompt", () => {
      const prompt = builder.build();
      expect(prompt.length).toBeGreaterThan(100);
    });
  });

  // ============ 优先级排序 ============

  describe("priority ordering", () => {
    test("critical sections 在 high sections 之前", () => {
      const prompt = builder.build();

      const identityPos = prompt.indexOf("<identity>");
      const stylePos = prompt.indexOf("<style>");

      expect(identityPos).toBeLessThan(stylePos);
    });

    test("high sections 在 medium sections 之前", () => {
      const prompt = builder.build();

      const toolPolicyPos = prompt.indexOf("<tool-policy>");
      const envPos = prompt.indexOf("<env>");

      expect(toolPolicyPos).toBeLessThan(envPos);
    });

    test("safety 紧跟 identity 之后", () => {
      const prompt = builder.build();

      const identityPos = prompt.indexOf("<identity>");
      const safetyPos = prompt.indexOf("<safety>");

      expect(safetyPos).toBeGreaterThan(identityPos);
      // safety 应该是第二个 section
      const betweenContent = prompt.slice(
        prompt.indexOf("</identity>"),
        safetyPos
      );
      // 中间不应该有其他 section 标签
      expect(betweenContent).not.toContain("<style>");
      expect(betweenContent).not.toContain("<env>");
    });
  });

  // ============ Section 管理 ============

  describe("section management", () => {
    test("注册自定义 section", () => {
      builder.register("custom", () => ({
        id: "custom",
        tag: "custom-section",
        title: "Custom",
        content: "Custom content here",
        priority: "low",
        weight: 50,
        enabled: true,
      }));

      const prompt = builder.build();
      expect(prompt).toContain("<custom-section>");
      expect(prompt).toContain("Custom content here");
      expect(prompt).toContain("</custom-section>");
    });

    test("注销 section", () => {
      builder.unregister("style");
      const prompt = builder.build();
      expect(prompt).not.toContain("<style>");
    });

    test("禁用 section", () => {
      builder.disable("task-management");
      const prompt = builder.build();
      expect(prompt).not.toContain("<task-management>");
    });

    test("启用被禁用的 section", () => {
      builder.disable("style");
      builder.enable("style");
      const prompt = builder.build();
      expect(prompt).toContain("<style>");
    });

    test("覆盖 section 属性", () => {
      builder.override("identity", {
        content: "You are a test agent.",
      });

      const prompt = builder.build();
      expect(prompt).toContain("You are a test agent.");
      expect(prompt).not.toContain("YTerm");
    });

    test("null factory 跳过 section", () => {
      builder.register("nullable", () => null);
      const prompt = builder.build();
      expect(prompt).not.toContain("nullable");
    });
  });

  // ============ XML 标签配置 ============

  describe("XML tag configuration", () => {
    test("默认使用 XML 标签", () => {
      const prompt = builder.build();
      expect(prompt).toMatch(/<identity>[\s\S]*<\/identity>/);
    });

    test("禁用 XML 标签", () => {
      const noXmlBuilder = new PromptBuilder({ useXmlTags: false });
      const prompt = noXmlBuilder.build();
      expect(prompt).not.toContain("<identity>");
      expect(prompt).not.toContain("</identity>");
      // 内容仍然存在
      expect(prompt).toContain("YTerm");
    });
  });

  // ============ buildSections ============

  describe("buildSections", () => {
    test("返回排序后的 section 列表", () => {
      const sections = builder.buildSections();

      expect(sections.length).toBeGreaterThan(0);

      // 验证排序：critical → high → medium
      let lastPriority = "critical";
      const priorityOrder = ["critical", "high", "medium", "low", "dynamic"];

      for (const section of sections) {
        const currentIdx = priorityOrder.indexOf(section.priority);
        const lastIdx = priorityOrder.indexOf(lastPriority);
        expect(currentIdx).toBeGreaterThanOrEqual(lastIdx);
        lastPriority = section.priority;
      }
    });

    test("不包含 disabled sections", () => {
      builder.disable("style");
      const sections = builder.buildSections();
      const ids = sections.map(s => s.id);
      expect(ids).not.toContain("style");
    });
  });

  // ============ 防幻觉 Section ============

  describe("anti-hallucination section", () => {
    test("无映射时不注入", () => {
      const prompt = builder.build();
      // anti-hallucination section 只在有活跃映射时才出现
      expect(prompt).not.toContain("<structured-id-references>");
    });

    test("有映射时注入占位符使用指令", () => {
      // 先通过 pipeline 创建映射
      const { getAntiHallucinationPipeline } = require("../../middleware/index.js");
      const pipeline = getAntiHallucinationPipeline();
      pipeline.processToolResult(
        "URL: https://docs.example.com/api/v1/guide?section=auth",
        "WebSearch"
      );

      const prompt = builder.build();
      expect(prompt).toContain("<structured-id-references>");
      expect(prompt).toContain("REF-1");
      expect(prompt).toContain("ALWAYS use the REF-N placeholder");
      expect(prompt).toContain("NEVER try to reconstruct");
      expect(prompt).toContain("</structured-id-references>");

      // 清理
      pipeline.reset();
    });
  });

  // ============ 环境 Section ============

  describe("environment section", () => {
    test("包含工作目录", () => {
      const prompt = builder.build();
      expect(prompt).toContain(process.cwd());
    });

    test("包含平台信息", () => {
      const prompt = builder.build();
      expect(prompt).toContain(process.platform);
    });

    test("包含日期", () => {
      const prompt = builder.build();
      const today = new Date().toISOString().split("T")[0];
      expect(prompt).toContain(today);
    });
  });

  // ============ 全局实例 ============

  describe("global singleton", () => {
    test("getPromptBuilder 返回同一实例", () => {
      const a = getPromptBuilder();
      const b = getPromptBuilder();
      expect(a).toBe(b);
    });

    test("resetPromptBuilder 创建新实例", () => {
      const a = getPromptBuilder();
      resetPromptBuilder();
      const b = getPromptBuilder();
      expect(a).not.toBe(b);
    });
  });

  // ============ Cache-Friendly 排序稳定性 ============

  describe("cache-friendly stability", () => {
    test("相同配置产生相同输出", () => {
      const prompt1 = builder.build();
      const prompt2 = builder.build();
      expect(prompt1).toBe(prompt2);
    });

    test("identity + safety 内容不变", () => {
      const sections1 = builder.buildSections();
      const sections2 = builder.buildSections();

      const identity1 = sections1.find(s => s.id === "identity")!;
      const identity2 = sections2.find(s => s.id === "identity")!;
      expect(identity1.content).toBe(identity2.content);

      const safety1 = sections1.find(s => s.id === "safety")!;
      const safety2 = sections2.find(s => s.id === "safety")!;
      expect(safety1.content).toBe(safety2.content);
    });
  });

  // ============ 长度控制 ============

  describe("max length control", () => {
    test("超长时从低优先级截断", () => {
      const shortBuilder = new PromptBuilder({ maxLength: 500 });
      const prompt = shortBuilder.build();

      // 应该保留 identity（最高优先级）
      expect(prompt).toContain("<identity>");
      // 长度应在限制内
      expect(prompt.length).toBeLessThanOrEqual(500);
    });
  });
});
