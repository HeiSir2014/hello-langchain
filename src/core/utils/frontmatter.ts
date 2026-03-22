/**
 * Markdown Frontmatter Parser
 *
 * Shared utility for parsing YAML frontmatter from markdown files.
 * Used by skill loader, custom commands loader, and other markdown-based configs.
 */

export interface ParsedFrontmatter {
  frontmatter: Record<string, any>;
  body: string;
}

/**
 * Parse YAML frontmatter from markdown content.
 *
 * Supports:
 * - Simple key: value pairs
 * - Arrays: [a, b, c]
 * - Booleans: true/false
 * - Numbers
 * - Wildcard: *
 * - Quoted strings (single or double quotes stripped)
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const [, yaml, body] = match;
  const frontmatter: Record<string, any> = {};

  for (const line of yaml.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Handle arrays: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1);
      frontmatter[key] = value.split(",").map((v) => v.trim().replace(/['"]/g, ""));
    } else if (value === "*") {
      frontmatter[key] = "*";
    } else if (value === "true") {
      frontmatter[key] = true;
    } else if (value === "false") {
      frontmatter[key] = false;
    } else if (!isNaN(Number(value)) && value !== "") {
      frontmatter[key] = Number(value);
    } else {
      frontmatter[key] = value.replace(/['"]/g, "");
    }
  }

  return { frontmatter, body: body.trim() };
}
