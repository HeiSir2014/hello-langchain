/**
 * Prompt Builder 测试
 *
 * 覆盖：
 * - 两层架构：system (static) vs message (dynamic)
 * - Section 注册/注销/覆盖/禁用
 * - 优先级排序
 * - XML 标签包裹
 * - 防幻觉 section 条件注入
 * - Cache 稳定性验证
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  PromptBuilder,
  getPromptBuilder,
  resetPromptBuilder,
} from "../builder.js";

describe("PromptBuilder", () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    resetPromptBuilder();
    builder = new PromptBuilder();
  });

  // ============ 两层架构 ============

  describe("two-layer architecture", () => {
    test("build() 只包含 layer:system 的 sections", () => {
      const systemPrompt = builder.build();

      // 静态 sections 应该存在
      expect(systemPrompt).toContain("<identity>");
      expect(systemPrompt).toContain("<safety>");
      expect(systemPrompt).toContain("<style>");
      expect(systemPrompt).toContain("<task-management>");
      expect(systemPrompt).toContain("<tool-policy>");
      expect(systemPrompt).toContain("<env>");

      // 动态 sections 不应该出现在 system prompt 中
      expect(systemPrompt).not.toContain("<active-skill>");
      expect(systemPrompt).not.toContain("<plan-mode>");
      expect(systemPrompt).not.toContain("<structured-id-references>");
    });

    test("buildDynamicInjection() 只包含 layer:message 的 sections", () => {
      // 默认无活跃技能、非 plan mode、无映射 → 空
      const dynamic = builder.buildDynamicInjection();
      expect(dynamic).toBe("");
    });

    test("system prompt 不包含任何动态内容", () => {
      const prompt1 = builder.build();
      const prompt2 = builder.build();
      // 两次调用必须完全相同
      expect(prompt1).toBe(prompt2);
    });
  });

  // ============ 基本构建 ============

  describe("basic build", () => {
    test("默认注册的 section IDs", () => {
      const ids = builder.getRegisteredSections();

      // Static sections
      expect(ids).toContain("identity");
      expect(ids).toContain("safety");
      expect(ids).toContain("style");
      expect(ids).toContain("task-management");
      expect(ids).toContain("tool-policy");
      expect(ids).toContain("environment");

      // Dynamic sections
      expect(ids).toContain("active-skill");
      expect(ids).toContain("plan-mode");
      expect(ids).toContain("anti-hallucination");
    });

    test("非空 system prompt", () => {
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
      const identityEnd = prompt.indexOf("</identity>");
      const safetyStart = prompt.indexOf("<safety>");
      const betweenContent = prompt.slice(identityEnd, safetyStart);
      expect(betweenContent).not.toContain("<style>");
      expect(betweenContent).not.toContain("<env>");
    });
  });

  // ============ Section 管理 ============

  describe("section management", () => {
    test("注册自定义 static section", () => {
      builder.register("custom", () => ({
        id: "custom",
        tag: "custom-section",
        title: "Custom",
        content: "Custom content here",
        priority: "low",
        weight: 50,
        enabled: true,
        layer: "system",
      }));

      const prompt = builder.build();
      expect(prompt).toContain("<custom-section>");
      expect(prompt).toContain("Custom content here");
    });

    test("注册自定义 dynamic section", () => {
      builder.register("custom-dynamic", () => ({
        id: "custom-dynamic",
        tag: "custom-dynamic",
        title: "Custom Dynamic",
        content: "Dynamic content",
        priority: "low",
        weight: 50,
        enabled: true,
        layer: "message",
      }));

      // 不在 system prompt 中
      const systemPrompt = builder.build();
      expect(systemPrompt).not.toContain("Dynamic content");

      // 在 dynamic injection 中
      const dynamic = builder.buildDynamicInjection();
      expect(dynamic).toContain("<custom-dynamic>");
      expect(dynamic).toContain("Dynamic content");
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
      expect(prompt).toContain("YTerm");
    });
  });

  // ============ buildSections ============

  describe("buildSections", () => {
    test("按 layer 过滤", () => {
      const systemSections = builder.buildSections("system");
      const messageSections = builder.buildSections("message");

      // system sections 不应包含 dynamic 的
      const systemIds = systemSections.map(s => s.id);
      expect(systemIds).toContain("identity");
      expect(systemIds).toContain("safety");
      expect(systemIds).not.toContain("anti-hallucination");

      // message sections 的 layer 都是 "message"
      for (const s of messageSections) {
        expect(s.layer).toBe("message");
      }
    });

    test("无参数时返回所有 sections", () => {
      const all = builder.buildSections();
      const systemOnly = builder.buildSections("system");
      expect(all.length).toBeGreaterThanOrEqual(systemOnly.length);
    });

    test("返回排序后的 section 列表", () => {
      const sections = builder.buildSections("system");
      expect(sections.length).toBeGreaterThan(0);

      const priorityOrder = ["critical", "high", "medium", "low", "dynamic"];
      let lastIdx = 0;
      for (const section of sections) {
        const currentIdx = priorityOrder.indexOf(section.priority);
        expect(currentIdx).toBeGreaterThanOrEqual(lastIdx);
        lastIdx = currentIdx;
      }
    });
  });

  // ============ 防幻觉 Section ============

  describe("anti-hallucination section", () => {
    test("无映射时不注入 system prompt", () => {
      const prompt = builder.build();
      expect(prompt).not.toContain("<structured-id-references>");
    });

    test("无映射时 dynamic injection 也为空", () => {
      const dynamic = builder.buildDynamicInjection();
      expect(dynamic).not.toContain("<structured-id-references>");
    });

    test("有映射时出现在 dynamic injection（非 system prompt）", () => {
      const { getAntiHallucinationPipeline } = require("../../middleware/index.js");
      const pipeline = getAntiHallucinationPipeline();
      pipeline.processToolResult(
        "URL: https://docs.example.com/api/v1/guide?section=auth",
        "WebSearch"
      );

      // 不在 system prompt
      const systemPrompt = builder.build();
      expect(systemPrompt).not.toContain("<structured-id-references>");
      expect(systemPrompt).not.toContain("REF-1");

      // 在 dynamic injection
      const dynamic = builder.buildDynamicInjection();
      expect(dynamic).toContain("<structured-id-references>");
      expect(dynamic).toContain("REF-1");
      expect(dynamic).toContain("ALWAYS use the REF-N placeholder");
      expect(dynamic).toContain("NEVER try to reconstruct");

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

  // ============ Cache-Friendly 稳定性 ============

  describe("cache-friendly stability", () => {
    test("system prompt 多次构建完全相同", () => {
      const prompt1 = builder.build();
      const prompt2 = builder.build();
      expect(prompt1).toBe(prompt2);
    });

    test("identity + safety 内容不变", () => {
      const sections1 = builder.buildSections("system");
      const sections2 = builder.buildSections("system");

      const identity1 = sections1.find(s => s.id === "identity")!;
      const identity2 = sections2.find(s => s.id === "identity")!;
      expect(identity1.content).toBe(identity2.content);

      const safety1 = sections1.find(s => s.id === "safety")!;
      const safety2 = sections2.find(s => s.id === "safety")!;
      expect(safety1.content).toBe(safety2.content);
    });

    test("dynamic injection 变化不影响 system prompt", () => {
      const systemBefore = builder.build();

      const { getAntiHallucinationPipeline } = require("../../middleware/index.js");
      const pipeline = getAntiHallucinationPipeline();
      pipeline.processToolResult(
        "See https://example.com/some-very-long-url/path?q=test for details",
        "WebSearch"
      );

      const systemAfter = builder.build();
      // system prompt 完全不受 dynamic sections 的影响
      expect(systemAfter).toBe(systemBefore);

      // 但 dynamic injection 变了
      const dynamic = builder.buildDynamicInjection();
      expect(dynamic).toContain("REF-");

      pipeline.reset();
    });
  });

  // ============ 长度控制 ============

  describe("max length control", () => {
    test("超长时从低优先级截断", () => {
      const shortBuilder = new PromptBuilder({ maxLength: 500 });
      const prompt = shortBuilder.build();
      expect(prompt).toContain("<identity>");
      expect(prompt.length).toBeLessThanOrEqual(500);
    });
  });
});
