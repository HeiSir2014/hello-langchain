/**
 * Frontmatter Parser Tests
 *
 * Covers:
 * - Basic key-value parsing
 * - Arrays, booleans, numbers, wildcards
 * - Quoted strings
 * - Missing frontmatter
 * - Body extraction
 * - Edge cases
 */

import { describe, test, expect } from "bun:test";
import { parseFrontmatter } from "../frontmatter.js";

describe("parseFrontmatter", () => {
  test("parses simple key-value pairs", () => {
    const content = `---
name: my-skill
description: A test skill
---
Body content here.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("my-skill");
    expect(result.frontmatter.description).toBe("A test skill");
    expect(result.body).toBe("Body content here.");
  });

  test("returns empty frontmatter for content without frontmatter", () => {
    const content = "Just plain content.";
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Just plain content.");
  });

  test("parses arrays", () => {
    const content = `---
tools: [Read, Write, Edit]
tags: [code, development]
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.tools).toEqual(["Read", "Write", "Edit"]);
    expect(result.frontmatter.tags).toEqual(["code", "development"]);
  });

  test("parses booleans", () => {
    const content = `---
readOnly: true
isHidden: false
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.readOnly).toBe(true);
    expect(result.frontmatter.isHidden).toBe(false);
  });

  test("parses numbers", () => {
    const content = `---
priority: 5
timeout: 30000
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.priority).toBe(5);
    expect(result.frontmatter.timeout).toBe(30000);
  });

  test("parses wildcard", () => {
    const content = `---
tools: *
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.tools).toBe("*");
  });

  test("strips quotes from values", () => {
    const content = `---
name: "my-skill"
alias: 'shortname'
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("my-skill");
    expect(result.frontmatter.alias).toBe("shortname");
  });

  test("strips quotes from array values", () => {
    const content = `---
aliases: ["mc", 'myc']
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.aliases).toEqual(["mc", "myc"]);
  });

  test("trims body content", () => {
    const content = `---
name: test
---

  Body with whitespace

`;

    const result = parseFrontmatter(content);
    expect(result.body).toBe("Body with whitespace");
  });

  test("handles multi-line body", () => {
    const content = `---
name: test
---
Line 1
Line 2
Line 3`;

    const result = parseFrontmatter(content);
    expect(result.body).toContain("Line 1");
    expect(result.body).toContain("Line 2");
    expect(result.body).toContain("Line 3");
  });

  test("handles empty frontmatter", () => {
    // Note: the regex requires at least one char between --- delimiters
    // An empty frontmatter block `---\n---` doesn't match, returns as body
    const content = `---

---
Body only`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Body only");
  });

  test("handles value with colon in it", () => {
    const content = `---
url: https://example.com
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.url).toBe("https://example.com");
  });

  test("handles empty value", () => {
    const content = `---
name:
---
Body`;

    const result = parseFrontmatter(content);
    // Empty string after colon -> empty string (not a number)
    expect(result.frontmatter.name).toBe("");
  });

  test("handles lines without colon", () => {
    const content = `---
name: test
just a random line
description: value
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("test");
    expect(result.frontmatter.description).toBe("value");
  });
});
