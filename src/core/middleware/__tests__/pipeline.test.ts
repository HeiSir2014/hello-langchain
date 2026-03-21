/**
 * Pipeline E2E 测试
 *
 * 模拟完整的 tool_result → LLM → 用户 消息流转管道，
 * 验证防幻觉系统的端到端行为。
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  AntiHallucinationPipeline,
  getAntiHallucinationPipeline,
  resetPipeline,
} from "../pipeline.js";

describe("AntiHallucinationPipeline", () => {
  let pipeline: AntiHallucinationPipeline;

  beforeEach(() => {
    pipeline = new AntiHallucinationPipeline();
  });

  // ============ Pre-Processing ============

  describe("processToolResult (pre-processing)", () => {
    test("替换 WebSearch 结果中的 URL", () => {
      const toolResult = JSON.stringify({
        results: [
          { title: "LangChain Docs", url: "https://docs.langchain.com/v1/guides/agents?ref=github", snippet: "Agent guide" },
          { title: "GitHub", url: "https://github.com/langchain-ai/langchain/tree/main/docs", snippet: "Source" },
        ],
      });

      const processed = pipeline.processToolResult(toolResult, "WebSearch");

      expect(processed).toContain("REF-1");
      expect(processed).toContain("REF-2");
      expect(processed).not.toContain("docs.langchain.com/v1/guides/agents");
      expect(processed).not.toContain("github.com/langchain-ai/langchain/tree/main/docs");
      // 标题和 snippet 保留
      expect(processed).toContain("LangChain Docs");
      expect(processed).toContain("Agent guide");
    });

    test("替换文件读取中的 UUID", () => {
      const fileContent = `
        const userId = "550e8400-e29b-41d4-a716-446655440000";
        const sessionId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
        const name = "John Doe";
      `;

      const processed = pipeline.processToolResult(fileContent, "Read");

      expect(processed).toContain("REF-1");
      expect(processed).toContain("REF-2");
      expect(processed).not.toContain("550e8400");
      expect(processed).not.toContain("6ba7b810");
      expect(processed).toContain("John Doe");
    });

    test("跳过配置中排除的工具", () => {
      const content = "Todo: 550e8400-e29b-41d4-a716-446655440000";
      const processed = pipeline.processToolResult(content, "TodoWrite");

      expect(processed).toBe(content);
      expect(pipeline.getSession().entries.length).toBe(0);
    });

    test("无高熵内容原样返回", () => {
      const content = "File created successfully at /home/user/app.ts";
      const processed = pipeline.processToolResult(content, "Write");

      expect(processed).toBe(content);
    });

    test("跨多个工具调用累积映射", () => {
      pipeline.processToolResult(
        "URL: https://api.example.com/v1/data?key=secret123",
        "WebFetch"
      );
      pipeline.processToolResult(
        "ID: 550e8400-e29b-41d4-a716-446655440000",
        "Read"
      );

      const session = pipeline.getSession();
      expect(session.entries.length).toBe(2);
      expect(session.entries[0].source).toBe("WebFetch");
      expect(session.entries[1].source).toBe("Read");
    });
  });

  // ============ Post-Processing ============

  describe("processModelOutput (post-processing)", () => {
    test("还原占位符为真实值", () => {
      // Pre-process
      pipeline.processToolResult(
        'Found at https://docs.langchain.com/v1/guides/agents?ref=github',
        "WebSearch"
      );

      // Simulate LLM output using placeholder
      const llmOutput = "You can find the documentation at REF-1.";
      const result = pipeline.processModelOutput(llmOutput);

      expect(result.content).toContain("https://docs.langchain.com/v1/guides/agents?ref=github");
      expect(result.content).not.toContain("REF-1");
      expect(result.restore.restoredCount).toBe(1);
    });

    test("无映射时直接通过", () => {
      const output = "Hello, world!";
      const result = pipeline.processModelOutput(output);

      expect(result.content).toBe(output);
      expect(result.restore.restoredCount).toBe(0);
      expect(result.validation.valid).toBe(true);
    });
  });

  // ============ E2E 场景 ============

  describe("E2E: 完整消息流转", () => {
    test("场景 1: WebSearch → LLM 引用 URL", () => {
      // 1. 工具返回搜索结果
      const searchResult = JSON.stringify([
        { title: "React Docs", url: "https://react.dev/reference/react/useState?lang=en", snippet: "useState hook" },
        { title: "MDN", url: "https://developer.mozilla.org/en-US/docs/Web/API/fetch?retiredLocale=zh-CN", snippet: "Fetch API" },
      ]);

      const processedResult = pipeline.processToolResult(searchResult, "WebSearch");

      // 2. 验证预处理
      expect(processedResult).toContain("REF-1");
      expect(processedResult).toContain("REF-2");
      expect(processedResult).not.toContain("react.dev/reference");
      expect(processedResult).not.toContain("developer.mozilla.org");

      // 3. LLM 使用占位符引用
      const llmResponse = "Here are the references:\n- React useState: REF-1\n- Fetch API: REF-2";
      const result = pipeline.processModelOutput(llmResponse);

      // 4. 验证后处理
      expect(result.content).toContain("https://react.dev/reference/react/useState?lang=en");
      expect(result.content).toContain("https://developer.mozilla.org/en-US/docs/Web/API/fetch?retiredLocale=zh-CN");
      expect(result.restore.restoredCount).toBe(2);
      expect(result.validation.valid).toBe(true);
    });

    test("场景 2: 数据库查询 → LLM 报告 UUID", () => {
      // 1. Bash 工具返回数据库查询结果
      const dbResult = `
        id                                   | name    | email
        550e8400-e29b-41d4-a716-446655440000 | Alice   | alice@example.com
        6ba7b810-9dad-11d1-80b4-00c04fd430c8 | Bob     | bob@example.com
        f47ac10b-58cc-4372-a567-0e02b2c3d479 | Charlie | charlie@example.com
      `;

      const processedResult = pipeline.processToolResult(dbResult, "Bash");

      // 2. 验证所有 UUID 被替换
      expect(processedResult).not.toContain("550e8400");
      expect(processedResult).not.toContain("6ba7b810");
      expect(processedResult).not.toContain("f47ac10b");
      // 名称保留
      expect(processedResult).toContain("Alice");
      expect(processedResult).toContain("Bob");
      expect(processedResult).toContain("Charlie");

      // 3. LLM 使用占位符
      const llmResponse = "Found 3 users. Alice's ID is REF-1, Bob's ID is REF-2, and Charlie's ID is REF-3.";
      const result = pipeline.processModelOutput(llmResponse);

      // 4. 验证还原
      expect(result.content).toContain("550e8400-e29b-41d4-a716-446655440000");
      expect(result.content).toContain("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
      expect(result.content).toContain("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    });

    test("场景 3: S3 签名 URL 保护", () => {
      // S3 签名 URL 是最容易被篡改的场景
      const s3Url = "https://my-bucket.s3.amazonaws.com/reports/2024/q1-report.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE&X-Amz-Signature=abc123def456ghi789";

      const processedResult = pipeline.processToolResult(`Download: ${s3Url}`, "Bash");

      expect(processedResult).toContain("REF-1");
      expect(processedResult).not.toContain("X-Amz-Signature");

      const llmResponse = "You can download the Q1 report from REF-1.";
      const result = pipeline.processModelOutput(llmResponse);

      expect(result.content).toContain(s3Url);
    });

    test("场景 4: 模糊匹配校正（LLM 篡改 URL）", () => {
      const originalUrl = "https://api.example.com/v1/reports/quarterly?year=2024&quarter=1";
      pipeline.processToolResult(`Report: ${originalUrl}`, "WebFetch");

      // LLM 没有使用占位符，而是自行生成了一个略有不同的 URL
      const llmResponse = "The quarterly report is at https://api.example.com/v1/reports/quarterly?year=2024&quarter=2";
      const result = pipeline.processModelOutput(llmResponse);

      // 应该检测到差异并校正
      expect(result.restore.corrections.length).toBe(1);
      expect(result.content).toContain(originalUrl);
    });

    test("场景 5: Git log 中的 commit hash", () => {
      const gitLog = `
        abc123def456789012345678901234567890abcd Fix: resolve auth issue
        def456abc789012345678901234567890abcd1234 Feat: add user profile
      `;

      const processed = pipeline.processToolResult(gitLog, "Bash");

      expect(processed).toContain("REF-");
      expect(processed).toContain("Fix: resolve auth issue");

      const llmResponse = "The auth fix is in commit REF-1, and the profile feature is in REF-2.";
      const result = pipeline.processModelOutput(llmResponse);

      expect(result.content).toContain("abc123def456789012345678901234567890abcd");
      expect(result.content).toContain("def456abc789012345678901234567890abcd1234");
    });
  });

  // ============ Pipeline 管理 ============

  describe("Pipeline management", () => {
    test("reset 清空所有状态", () => {
      pipeline.processToolResult(
        "URL: https://api.example.com/v1/data?key=test123",
        "WebSearch"
      );

      expect(pipeline.hasActiveMappings()).toBe(true);
      expect(pipeline.getStats().remappedCount).toBeGreaterThan(0);

      pipeline.reset();

      expect(pipeline.hasActiveMappings()).toBe(false);
      expect(pipeline.getStats().remappedCount).toBe(0);
    });

    test("getReferenceTable 有映射时返回内容", () => {
      expect(pipeline.getReferenceTable()).toBe("");

      pipeline.processToolResult(
        "See https://docs.example.com/api/v1/guide?section=auth",
        "WebFetch"
      );

      const table = pipeline.getReferenceTable();
      expect(table).toContain("REF-1");
      expect(table).toContain("<reference-map>");
    });

    test("getStats 追踪统计信息", () => {
      pipeline.processToolResult(
        "https://api.example.com/v1/data?key=123",
        "WebSearch"
      );

      const stats = pipeline.getStats();
      expect(stats.remappedCount).toBeGreaterThan(0);
      expect(stats.restoredCount).toBe(0);

      pipeline.processModelOutput("See REF-1 for details.");
      const updatedStats = pipeline.getStats();
      expect(updatedStats.restoredCount).toBeGreaterThan(0);
    });

    test("禁用配置生效", () => {
      const disabledPipeline = new AntiHallucinationPipeline({
        enableIdRemapping: false,
      });

      const content = "UUID: 550e8400-e29b-41d4-a716-446655440000";
      const processed = disabledPipeline.processToolResult(content, "Read");

      expect(processed).toBe(content);
    });
  });

  // ============ 全局单例 ============

  describe("Global singleton", () => {
    test("getAntiHallucinationPipeline 返回单例", () => {
      const p1 = getAntiHallucinationPipeline();
      const p2 = getAntiHallucinationPipeline();
      expect(p1).toBe(p2);
    });

    test("resetPipeline 重置全局状态", () => {
      const p = getAntiHallucinationPipeline();
      p.processToolResult(
        "https://api.example.com/v1/data?key=abc",
        "WebSearch"
      );

      expect(p.hasActiveMappings()).toBe(true);

      resetPipeline();

      expect(p.hasActiveMappings()).toBe(false);
    });
  });

  // ============ 边界情况 ============

  describe("Edge cases", () => {
    test("空内容处理", () => {
      expect(pipeline.processToolResult("", "Read")).toBe("");
      const result = pipeline.processModelOutput("");
      expect(result.content).toBe("");
    });

    test("超大 tool_result 性能", () => {
      // 生成一个包含 100 个 URL 的大文本
      const urls = Array.from({ length: 100 }, (_, i) =>
        `https://api.example.com/v1/items/${i}?token=abc${i}def${i * 2}`
      );
      const bigContent = urls.join("\n");

      const start = Date.now();
      pipeline.processToolResult(bigContent, "WebSearch");
      const duration = Date.now() - start;

      // 应该在合理时间内完成（< 1秒）
      expect(duration).toBeLessThan(1000);
      expect(pipeline.getSession().entries.length).toBe(100);
    });

    test("特殊字符不破坏替换", () => {
      const content = 'URL with special chars: https://api.example.com/v1/data?q=hello+world&lang=zh-CN&key=abc%20123';
      const processed = pipeline.processToolResult(content, "WebFetch");

      expect(processed).toContain("REF-1");
      expect(processed).not.toContain("q=hello+world");

      const result = pipeline.processModelOutput("See REF-1.");
      expect(result.content).toContain("hello+world");
    });

    test("Markdown 格式中的 URL 替换", () => {
      const content = "Check [this link](https://docs.example.com/api/v1/guide?section=auth) for details.";
      const processed = pipeline.processToolResult(content, "WebFetch");

      // URL 应该被替换，但 markdown 语法保留
      expect(processed).toContain("REF-1");
      expect(processed).toContain("[this link]");
    });

    test("嵌套 JSON 中的深层 URL", () => {
      const content = JSON.stringify({
        data: {
          nested: {
            deep: {
              url: "https://deep.example.com/api/v3/data?nested=true&deep=very"
            }
          }
        }
      });

      const processed = pipeline.processToolResult(content, "WebFetch");
      expect(processed).toContain("REF-1");
    });
  });
});
