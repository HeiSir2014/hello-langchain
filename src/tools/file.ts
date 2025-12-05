import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
} from "fs";
import { resolve, dirname, relative, join } from "path";
import { spawnSync } from "child_process";
import { glob } from "glob";
import { rgPath } from "@vscode/ripgrep";
import { writeToTempFile, OUTPUT_THRESHOLD } from "./bash.js";
import { log } from "../logger.js";

// Read 工具 - 读取文件内容
export const Read = tool(
  async ({ file_path, limit = 2000, offset = 0 }) => {
    const startTime = Date.now();
    log.toolStart("Read", { file_path, limit, offset });

    try {
      const absolutePath = resolve(process.cwd(), file_path);

      if (!existsSync(absolutePath)) {
        log.toolError("Read", `File not found: ${file_path}`);
        return `Error: File not found - ${file_path}`;
      }

      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        log.toolError("Read", `Path is a directory: ${file_path}`);
        return `Error: Path is a directory, not a file - ${file_path}. Use Bash with 'ls' or 'dir' to list directory contents.`;
      }

      const content = readFileSync(absolutePath, "utf-8");
      const lines = content.split("\n");
      const totalLines = lines.length;

      // 处理 offset 和 limit (offset 是 1-indexed 在显示上，但参数是行号)
      const startLine = offset;
      const endLine = Math.min(startLine + limit, totalLines);
      const selectedLines = lines.slice(startLine, endLine);

      // 添加行号 (cat -n 格式: 右对齐行号 + tab + 内容)
      const numberedLines = selectedLines.map((line, i) => {
        const lineNum = (startLine + i + 1).toString().padStart(6, " ");
        // 截断过长的行
        const truncatedLine = line.length > 2000 ? line.slice(0, 2000) + "..." : line;
        return `${lineNum}\t${truncatedLine}`;
      });

      const result = numberedLines.join("\n");

      log.toolEnd("Read", Date.now() - startTime, result.length);

      // 如果还有更多行，添加提示
      if (endLine < totalLines) {
        return result + `\n\n[... ${totalLines - endLine} more lines. Use offset=${endLine} to continue reading.]`;
      }

      return result;
    } catch (error: any) {
      log.toolError("Read", error.message);
      return `Error reading file: ${error.message}`;
    }
  },
  {
    name: "Read",
    description: `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). PDFs are processed page by page, extracting both text and visual content for analysis.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`,
    schema: z.object({
      file_path: z.string().describe("The absolute path to the file to read"),
      offset: z.coerce.number().optional().describe("The line number to start reading from. Only provide if the file is too large to read at once"),
      limit: z.coerce.number().optional().describe("The number of lines to read. Only provide if the file is too large to read at once."),
    }),
  }
);

// Write 工具 - 写入文件内容
export const Write = tool(
  async ({ file_path, content }) => {
    const startTime = Date.now();
    log.toolStart("Write", { file_path, contentLength: content.length });

    try {
      const absolutePath = resolve(process.cwd(), file_path);
      const dir = dirname(absolutePath);

      // 确保目录存在
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(absolutePath, content, "utf-8");
      const lines = content.split("\n").length;
      const bytes = Buffer.byteLength(content, "utf-8");

      log.toolEnd("Write", Date.now() - startTime, bytes);
      return `File written successfully: ${file_path} (${lines} lines, ${bytes} bytes)`;
    } catch (error: any) {
      log.toolError("Write", error.message);
      return `Error writing file: ${error.message}`;
    }
  },
  {
    name: "Write",
    description: `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`,
    schema: z.object({
      file_path: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
      content: z.string().describe("The content to write to the file"),
    }),
  }
);

// Edit 工具 - 编辑文件（字符串替换）
// 规范化换行符（将 \r\n 转换为 \n，或将 \n 转换为文件中使用的换行符）
function normalizeLineEndings(content: string, targetEnding: string): string {
  // 先统一转换为 \n
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // 然后转换为目标换行符
  if (targetEnding === "\r\n") {
    return normalized.replace(/\n/g, "\r\n");
  }
  return normalized;
}

// 检测文件中使用的换行符
function detectLineEnding(content: string): string {
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
  return crlfCount > lfCount ? "\r\n" : "\n";
}

export const Edit = tool(
  async ({ file_path, old_string, new_string, replace_all = false }) => {
    const startTime = Date.now();
    log.toolStart("Edit", { file_path, oldLength: old_string.length, newLength: new_string.length, replace_all });

    try {
      const absolutePath = resolve(process.cwd(), file_path);

      if (!existsSync(absolutePath)) {
        log.toolError("Edit", `File not found: ${file_path}`);
        return `Error: File not found - ${file_path}`;
      }

      const rawContent = readFileSync(absolutePath, "utf-8");
      const fileLineEnding = detectLineEnding(rawContent);

      // 规范化文件内容和搜索字符串为统一的 \n
      const content = normalizeLineEndings(rawContent, "\n");
      const normalizedOldString = normalizeLineEndings(old_string, "\n");
      const normalizedNewString = normalizeLineEndings(new_string, "\n");

      // 检查 old_string 是否存在
      if (!content.includes(normalizedOldString)) {
        // 尝试更宽松的匹配：忽略行尾空白差异
        const trimmedContent = content.split("\n").map(line => line.trimEnd()).join("\n");
        const trimmedOldString = normalizedOldString.split("\n").map(line => line.trimEnd()).join("\n");

        if (trimmedContent.includes(trimmedOldString)) {
          log.toolError("Edit", `old_string not found - trailing whitespace mismatch`);
          return `Error: old_string not found in file. The content exists but has trailing whitespace differences. Please check and remove any trailing spaces/tabs from your old_string.`;
        }

        log.toolError("Edit", `old_string not found in file`);
        return `Error: old_string not found in file. Make sure you preserve the exact indentation (tabs/spaces) as it appears in the file.`;
      }

      // 检查是否有多个匹配
      const matches = content.split(normalizedOldString).length - 1;
      if (matches > 1 && !replace_all) {
        log.toolError("Edit", `Found ${matches} matches`);
        return `Error: Found ${matches} occurrences of old_string. Either provide a larger string with more surrounding context to make it unique, or use replace_all=true to change every instance.`;
      }

      // 执行替换
      let newContent: string;
      if (replace_all) {
        newContent = content.split(normalizedOldString).join(normalizedNewString);
      } else {
        newContent = content.replace(normalizedOldString, normalizedNewString);
      }

      // 恢复原始文件的换行符风格
      newContent = normalizeLineEndings(newContent, fileLineEnding);

      writeFileSync(absolutePath, newContent, "utf-8");

      const replacedCount = replace_all ? matches : 1;
      log.toolEnd("Edit", Date.now() - startTime, newContent.length);
      return `File edited successfully: ${file_path}\nReplaced ${replacedCount} occurrence(s)`;
    } catch (error: any) {
      log.toolError("Edit", error.message);
      return `Error editing file: ${error.message}`;
    }
  },
  {
    name: "Edit",
    description: `Performs exact string replacements in files.

Usage:
- You must use your Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance of old_string.
- Use replace_all for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`,
    schema: z.object({
      file_path: z.string().describe("The absolute path to the file to modify"),
      old_string: z.string().describe("The text to replace"),
      new_string: z.string().describe("The text to replace it with (must be different from old_string)"),
      replace_all: z.coerce.boolean().optional().default(false).describe("Replace all occurences of old_string (default false)"),
    }),
  }
);

// Glob 工具 - 文件模式匹配搜索
export const Glob = tool(
  async ({ pattern, path }) => {
    const startTime = Date.now();
    log.toolStart("Glob", { pattern, path });

    try {
      const searchPath = path ? resolve(process.cwd(), path) : process.cwd();

      if (!existsSync(searchPath)) {
        log.toolError("Glob", `Path not found: ${searchPath}`);
        return `Error: Path not found - ${searchPath}`;
      }

      // 使用 glob 包进行文件匹配
      const files = await glob(pattern, {
        cwd: searchPath,
        nodir: true,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.git/**"],
        maxDepth: pattern.includes("**") ? undefined : 10,
      });

      // 按修改时间排序
      const sortedFiles = files
        .map(f => {
          try {
            return { path: f, mtime: statSync(f).mtime.getTime() };
          } catch {
            return { path: f, mtime: 0 };
          }
        })
        .sort((a, b) => b.mtime - a.mtime)
        .map(f => f.path);

      if (sortedFiles.length === 0) {
        log.toolEnd("Glob", Date.now() - startTime, 0);
        return `No files found matching pattern "${pattern}"`;
      }

      const relativePaths = sortedFiles.map(f => relative(process.cwd(), f));

      log.toolEnd("Glob", Date.now() - startTime, sortedFiles.length);

      return relativePaths.join("\n");
    } catch (error: any) {
      log.toolError("Glob", error.message);
      return `Error searching files: ${error.message}`;
    }
  },
  {
    name: "Glob",
    description: `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.`,
    schema: z.object({
      pattern: z.string().describe("The glob pattern to match files against"),
      path: z.string().optional().describe("The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter \"undefined\" or \"null\" - simply omit it for the default behavior. Must be a valid directory path if provided."),
    }),
  }
);

// Grep 工具 - 使用 ripgrep 进行内容搜索
export const Grep = tool(
  async ({
    pattern,
    path,
    glob: globPattern,
    output_mode = "files_with_matches",
    "-B": beforeContext,
    "-A": afterContext,
    "-C": context,
    "-n": showLineNumbers = true,
    "-i": ignoreCase,
    type,
    head_limit = 100,
    offset = 0,
    multiline = false,
  }) => {
    const startTime = Date.now();
    log.toolStart("Grep", { pattern, path, glob: globPattern, output_mode, head_limit });

    try {
      const searchPath = path ? resolve(process.cwd(), path) : process.cwd();

      if (!existsSync(searchPath)) {
        log.toolError("Grep", `Path not found: ${searchPath}`);
        return `Error: Path not found - ${searchPath}`;
      }

      // 构建 ripgrep 参数
      const args: string[] = [
        "--color=never",
      ];

      // 输出模式
      if (output_mode === "files_with_matches") {
        args.push("--files-with-matches");
      } else if (output_mode === "count") {
        args.push("--count");
      } else {
        // content 模式
        if (showLineNumbers) {
          args.push("--line-number");
        }
        if (beforeContext) args.push(`-B${beforeContext}`);
        if (afterContext) args.push(`-A${afterContext}`);
        if (context) args.push(`-C${context}`);
      }

      // 忽略大小写
      if (ignoreCase) {
        args.push("--ignore-case");
      }

      // 多行模式
      if (multiline) {
        args.push("-U");
        args.push("--multiline-dotall");
      }

      // 文件类型过滤
      if (type) {
        args.push(`--type=${type}`);
      }
      if (globPattern) {
        args.push(`--glob=${globPattern}`);
      }

      // 排除目录
      args.push("--glob=!node_modules");
      args.push("--glob=!.git");
      args.push("--glob=!dist");
      args.push("--glob=!build");
      args.push("--glob=!*.min.js");
      args.push("--glob=!*.min.css");
      args.push("--glob=!package-lock.json");
      args.push("--glob=!yarn.lock");
      args.push("--glob=!pnpm-lock.yaml");

      // 搜索模式和路径
      args.push(pattern);
      args.push(searchPath);

      // 使用 spawnSync 执行 ripgrep
      const result = spawnSync(rgPath, args, {
        encoding: "utf-8",
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 10,
      });

      if (result.status === 2) {
        log.toolError("Grep", result.stderr || "Unknown error");
        return `Search error: ${result.stderr || "Unknown error"}`;
      }

      let output = result.stdout?.trim() || "";

      if (!output || result.status === 1) {
        log.toolEnd("Grep", Date.now() - startTime, 0);
        return `No matches found for pattern "${pattern}"`;
      }

      // 将绝对路径转换为相对路径
      const cwd = process.cwd();
      let lines = output.split("\n").map(line => {
        if (line.startsWith(cwd)) {
          return line.slice(cwd.length + 1);
        }
        // Windows 路径处理
        if (line.startsWith(cwd.replace(/\//g, "\\"))) {
          return line.slice(cwd.length + 1);
        }
        return line;
      });

      // 应用 offset 和 head_limit
      if (offset > 0) {
        lines = lines.slice(offset);
      }
      if (head_limit > 0) {
        lines = lines.slice(0, head_limit);
      }

      const formattedOutput = lines.join("\n");
      log.toolEnd("Grep", Date.now() - startTime, formattedOutput.length);

      return formattedOutput;
    } catch (error: any) {
      log.toolError("Grep", error.message);
      return `Search error: ${error.message}`;
    }
  },
  {
    name: "Grep",
    description: `A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke \`grep\` or \`rg\` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Task tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use \`interface\\{\\}\` to find \`interface{}\` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like \`struct \\{[\\s\\S]*?field\`, use \`multiline: true\`
`,
    schema: z.object({
      pattern: z.string().describe("The regular expression pattern to search for in file contents"),
      path: z.string().optional().describe("File or directory to search in (rg PATH). Defaults to current working directory."),
      glob: z.string().optional().describe("Glob pattern to filter files (e.g. \"*.js\", \"*.{ts,tsx}\") - maps to rg --glob"),
      output_mode: z.enum(["content", "files_with_matches", "count"]).optional().describe("Output mode: \"content\" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), \"files_with_matches\" shows file paths (supports head_limit), \"count\" shows match counts (supports head_limit). Defaults to \"files_with_matches\"."),
      "-B": z.coerce.number().optional().describe("Number of lines to show before each match (rg -B). Requires output_mode: \"content\", ignored otherwise."),
      "-A": z.coerce.number().optional().describe("Number of lines to show after each match (rg -A). Requires output_mode: \"content\", ignored otherwise."),
      "-C": z.coerce.number().optional().describe("Number of lines to show before and after each match (rg -C). Requires output_mode: \"content\", ignored otherwise."),
      "-n": z.coerce.boolean().optional().describe("Show line numbers in output (rg -n). Requires output_mode: \"content\", ignored otherwise. Defaults to true."),
      "-i": z.coerce.boolean().optional().describe("Case insensitive search (rg -i)"),
      type: z.string().optional().describe("File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types."),
      head_limit: z.coerce.number().optional().describe("Limit output to first N lines/entries, equivalent to \"| head -N\". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults based on \"cap\" experiment value: 0 (unlimited), 20, or 100."),
      offset: z.coerce.number().optional().describe("Skip first N lines/entries before applying head_limit, equivalent to \"| tail -n +N | head -N\". Works across all output modes. Defaults to 0."),
      multiline: z.coerce.boolean().optional().describe("Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false."),
    }),
  }
);

// LS 工具 - 列出目录内容
export const LS = tool(
  async ({ path = ".", all = false }) => {
    const startTime = Date.now();
    log.toolStart("LS", { path, all });

    try {
      const absolutePath = resolve(process.cwd(), path);

      if (!existsSync(absolutePath)) {
        log.toolError("LS", `Path not found: ${path}`);
        return `Error: Path not found - ${path}`;
      }

      const stat = statSync(absolutePath);
      if (!stat.isDirectory()) {
        log.toolEnd("LS", Date.now() - startTime, 1);
        return `${path} (${stat.size} bytes, modified: ${stat.mtime.toISOString()})`;
      }

      const items = readdirSync(absolutePath);
      const results: string[] = [];

      for (const item of items) {
        if (!all && item.startsWith(".")) continue;

        const fullPath = join(absolutePath, item);
        try {
          const itemStat = statSync(fullPath);
          if (itemStat.isDirectory()) {
            results.push(`${item}/`);
          } else {
            results.push(item);
          }
        } catch {
          results.push(`${item} (inaccessible)`);
        }
      }

      log.toolEnd("LS", Date.now() - startTime, results.length);

      if (results.length === 0) {
        return `Directory is empty: ${path}`;
      }

      return results.join("\n");
    } catch (error: any) {
      log.toolError("LS", error.message);
      return `Error listing directory: ${error.message}`;
    }
  },
  {
    name: "LS",
    description: "List directory contents. Shows files and subdirectories.",
    schema: z.object({
      path: z.string().optional().describe("Directory path, defaults to current directory"),
      all: z.coerce.boolean().optional().describe("Show hidden files (starting with .), default false"),
    }),
  }
);
