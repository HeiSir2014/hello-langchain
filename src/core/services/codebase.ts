/**
 * Codebase Analysis Service
 *
 * Provides codebase analysis capabilities for AI agents:
 * - Directory structure scanning
 * - Git status and history
 * - Code style detection
 * - Project documentation discovery
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { log } from "../../logger.js";

// ============ Types ============

export interface CodebaseContext {
  directoryStructure: string;
  gitStatus: string;
  projectDocs: ProjectDocs;
  packageInfo: PackageInfo | null;
  codeStyle: CodeStyleInfo;
}

export interface ProjectDocs {
  claudeMd: string | null;
  readmeMd: string | null;
  cursorRules: string | null;
  copilotInstructions: string | null;
}

export interface PackageInfo {
  name: string;
  version: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface CodeStyleInfo {
  hasEslint: boolean;
  hasPrettier: boolean;
  hasTypeScript: boolean;
  hasBiome: boolean;
  moduleType: "esm" | "commonjs" | "unknown";
  framework: string | null;
}

// ============ Directory Structure ============

/**
 * Generate directory tree structure
 */
export function getDirectoryStructure(
  rootPath: string = process.cwd(),
  maxDepth: number = 4,
  maxFiles: number = 200
): string {
  const ignorePatterns = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "coverage",
    ".cache",
    ".turbo",
    "__pycache__",
    ".pytest_cache",
    "target",
    "vendor",
    ".idea",
    ".vscode",
  ];

  const lines: string[] = [];
  let fileCount = 0;

  function traverse(dir: string, depth: number, prefix: string): void {
    if (depth > maxDepth || fileCount >= maxFiles) return;

    try {
      const entries = readdirSync(dir).filter(
        (name) => !ignorePatterns.includes(name) && !name.startsWith(".")
      );
      entries.sort((a, b) => {
        const aIsDir = statSync(join(dir, a)).isDirectory();
        const bIsDir = statSync(join(dir, b)).isDirectory();
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a.localeCompare(b);
      });

      for (let i = 0; i < entries.length && fileCount < maxFiles; i++) {
        const entry = entries[i];
        const fullPath = join(dir, entry);
        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          lines.push(`${prefix}${connector}${entry}/`);
          traverse(fullPath, depth + 1, prefix + (isLast ? "    " : "│   "));
        } else {
          lines.push(`${prefix}${connector}${entry}`);
          fileCount++;
        }
      }
    } catch (error: any) {
      log.debug(`Error reading directory ${dir}: ${error.message}`);
    }
  }

  lines.push(relative(process.cwd(), rootPath) || ".");
  traverse(rootPath, 0, "");

  if (fileCount >= maxFiles) {
    lines.push(`... (truncated, showing ${maxFiles} files)`);
  }

  return lines.join("\n");
}

// ============ Git Status ============

/**
 * Get comprehensive git status
 */
export function getGitStatus(): string {
  try {
    const cwd = process.cwd();
    const parts: string[] = [];

    // Current branch
    const branch = execSync("git branch --show-current", {
      encoding: "utf-8",
      cwd,
    }).trim();
    parts.push(`Current branch: ${branch}`);

    // Main/master branch detection
    try {
      const mainBranch = execSync(
        "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'",
        { encoding: "utf-8", cwd }
      ).trim();
      if (mainBranch) {
        parts.push(`Main branch: ${mainBranch}`);
      }
    } catch {
      // No remote HEAD configured
    }

    // Status
    const status = execSync("git status --short", { encoding: "utf-8", cwd }).trim();
    parts.push(`\nStatus:\n${status || "(clean)"}`);

    // Recent commits
    const recentCommits = execSync("git log --oneline -5", {
      encoding: "utf-8",
      cwd,
    }).trim();
    parts.push(`\nRecent commits:\n${recentCommits}`);

    return parts.join("\n");
  } catch {
    return "Git status unavailable (not a git repository)";
  }
}

// ============ Project Documentation ============

/**
 * Read project documentation files
 */
export function getProjectDocs(): ProjectDocs {
  const cwd = process.cwd();

  const docs: ProjectDocs = {
    claudeMd: null,
    readmeMd: null,
    cursorRules: null,
    copilotInstructions: null,
  };

  // CLAUDE.md / AGENTS.md
  const claudeLocations = [
    join(cwd, "CLAUDE.md"),
    join(cwd, "AGENTS.md"),
    join(cwd, ".claude", "CLAUDE.md"),
  ];
  for (const loc of claudeLocations) {
    if (existsSync(loc)) {
      try {
        docs.claudeMd = readFileSync(loc, "utf-8");
        break;
      } catch {}
    }
  }

  // README.md
  const readmeLocations = [
    join(cwd, "README.md"),
    join(cwd, "readme.md"),
    join(cwd, "Readme.md"),
  ];
  for (const loc of readmeLocations) {
    if (existsSync(loc)) {
      try {
        docs.readmeMd = readFileSync(loc, "utf-8");
        break;
      } catch {}
    }
  }

  // Cursor rules
  const cursorLocations = [
    join(cwd, ".cursor", "rules"),
    join(cwd, ".cursorrules"),
  ];
  for (const loc of cursorLocations) {
    if (existsSync(loc)) {
      try {
        const stat = statSync(loc);
        if (stat.isDirectory()) {
          // Read all files in .cursor/rules/
          const files = readdirSync(loc);
          const contents = files
            .filter((f) => f.endsWith(".md") || f.endsWith(".mdc"))
            .map((f) => readFileSync(join(loc, f), "utf-8"));
          if (contents.length > 0) {
            docs.cursorRules = contents.join("\n\n---\n\n");
          }
        } else {
          docs.cursorRules = readFileSync(loc, "utf-8");
        }
        break;
      } catch {}
    }
  }

  // Copilot instructions
  const copilotPath = join(cwd, ".github", "copilot-instructions.md");
  if (existsSync(copilotPath)) {
    try {
      docs.copilotInstructions = readFileSync(copilotPath, "utf-8");
    } catch {}
  }

  return docs;
}

// ============ Package Info ============

/**
 * Read package.json information
 */
export function getPackageInfo(): PackageInfo | null {
  const packagePath = join(process.cwd(), "package.json");
  if (!existsSync(packagePath)) return null;

  try {
    const content = readFileSync(packagePath, "utf-8");
    const pkg = JSON.parse(content);
    return {
      name: pkg.name || "unknown",
      version: pkg.version || "0.0.0",
      scripts: pkg.scripts || {},
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
    };
  } catch (error: any) {
    log.warn(`Failed to read package.json: ${error.message}`);
    return null;
  }
}

// ============ Code Style Detection ============

/**
 * Detect code style configuration
 */
export function getCodeStyle(): CodeStyleInfo {
  const cwd = process.cwd();

  const info: CodeStyleInfo = {
    hasEslint: false,
    hasPrettier: false,
    hasTypeScript: false,
    hasBiome: false,
    moduleType: "unknown",
    framework: null,
  };

  // ESLint
  const eslintFiles = [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yaml",
    ".eslintrc.yml",
    "eslint.config.js",
    "eslint.config.mjs",
  ];
  info.hasEslint = eslintFiles.some((f) => existsSync(join(cwd, f)));

  // Prettier
  const prettierFiles = [
    ".prettierrc",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.json",
    ".prettierrc.yaml",
    ".prettierrc.yml",
    "prettier.config.js",
    "prettier.config.mjs",
  ];
  info.hasPrettier = prettierFiles.some((f) => existsSync(join(cwd, f)));

  // Biome
  info.hasBiome = existsSync(join(cwd, "biome.json")) || existsSync(join(cwd, "biome.jsonc"));

  // TypeScript
  info.hasTypeScript = existsSync(join(cwd, "tsconfig.json"));

  // Module type from package.json
  const pkg = getPackageInfo();
  if (pkg) {
    // Detect module type
    const packagePath = join(cwd, "package.json");
    try {
      const content = readFileSync(packagePath, "utf-8");
      const pkgJson = JSON.parse(content);
      if (pkgJson.type === "module") {
        info.moduleType = "esm";
      } else if (pkgJson.type === "commonjs" || !pkgJson.type) {
        info.moduleType = "commonjs";
      }
    } catch {}

    // Detect framework
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps["next"]) info.framework = "Next.js";
    else if (allDeps["nuxt"]) info.framework = "Nuxt";
    else if (allDeps["@angular/core"]) info.framework = "Angular";
    else if (allDeps["vue"]) info.framework = "Vue";
    else if (allDeps["react"]) info.framework = "React";
    else if (allDeps["svelte"]) info.framework = "Svelte";
    else if (allDeps["express"]) info.framework = "Express";
    else if (allDeps["fastify"]) info.framework = "Fastify";
    else if (allDeps["hono"]) info.framework = "Hono";
  }

  return info;
}

// ============ Main Export ============

/**
 * Collect complete codebase context for AI analysis
 */
export function collectCodebaseContext(): CodebaseContext {
  log.info("Collecting codebase context...");

  const context: CodebaseContext = {
    directoryStructure: getDirectoryStructure(),
    gitStatus: getGitStatus(),
    projectDocs: getProjectDocs(),
    packageInfo: getPackageInfo(),
    codeStyle: getCodeStyle(),
  };

  log.info("Codebase context collected", {
    hasClaudeMd: !!context.projectDocs.claudeMd,
    hasReadme: !!context.projectDocs.readmeMd,
    hasCursorRules: !!context.projectDocs.cursorRules,
    hasCopilotInstructions: !!context.projectDocs.copilotInstructions,
    hasPackageInfo: !!context.packageInfo,
    framework: context.codeStyle.framework,
  });

  return context;
}

/**
 * Format codebase context as prompt for AI
 */
export function formatCodebaseContextForPrompt(context: CodebaseContext): string {
  const parts: string[] = [];

  // Directory structure
  parts.push("## Directory Structure\n```\n" + context.directoryStructure + "\n```");

  // Git status
  parts.push("## Git Status\n```\n" + context.gitStatus + "\n```");

  // Package info
  if (context.packageInfo) {
    parts.push("## Package Info");
    parts.push(`- Name: ${context.packageInfo.name}`);
    parts.push(`- Version: ${context.packageInfo.version}`);
    if (Object.keys(context.packageInfo.scripts).length > 0) {
      parts.push("- Scripts:");
      for (const [name, cmd] of Object.entries(context.packageInfo.scripts)) {
        parts.push(`  - \`${name}\`: \`${cmd}\``);
      }
    }
  }

  // Code style
  parts.push("## Code Style Detection");
  const styleItems: string[] = [];
  if (context.codeStyle.hasTypeScript) styleItems.push("TypeScript");
  if (context.codeStyle.hasEslint) styleItems.push("ESLint");
  if (context.codeStyle.hasPrettier) styleItems.push("Prettier");
  if (context.codeStyle.hasBiome) styleItems.push("Biome");
  if (context.codeStyle.framework) styleItems.push(`Framework: ${context.codeStyle.framework}`);
  styleItems.push(`Module: ${context.codeStyle.moduleType}`);
  parts.push(styleItems.join(", "));

  // Existing docs
  if (context.projectDocs.claudeMd) {
    parts.push("## Existing CLAUDE.md\n```markdown\n" + context.projectDocs.claudeMd + "\n```");
  }
  if (context.projectDocs.cursorRules) {
    parts.push("## Cursor Rules\n```markdown\n" + context.projectDocs.cursorRules + "\n```");
  }
  if (context.projectDocs.copilotInstructions) {
    parts.push(
      "## Copilot Instructions\n```markdown\n" +
        context.projectDocs.copilotInstructions +
        "\n```"
    );
  }

  return parts.join("\n\n");
}
