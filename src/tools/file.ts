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
import { writeToTempFile, OUTPUT_THRESHOLD } from "./bash";
import { log } from "../logger";

// Read 工具 - 读取文件内容
export const Read = tool(
  async ({ file_path, limit = 200, offset = 0 }) => {
    const startTime = Date.now();
    log.toolStart("Read", { file_path, limit, offset });

    try {
      const absolutePath = resolve(process.cwd(), file_path);

      if (!existsSync(absolutePath)) {
        log.toolError("Read", `文件不存在: ${file_path}`);
        return `错误: 文件不存在 - ${file_path}`;
      }

      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        log.toolError("Read", `路径是目录: ${file_path}`);
        return `错误: 路径是目录而非文件 - ${file_path}`;
      }

      const content = readFileSync(absolutePath, "utf-8");
      const lines = content.split("\n");
      const totalLines = lines.length;
      const totalBytes = stat.size;

      // 处理 offset 和 limit
      const startLine = offset;
      const endLine = Math.min(startLine + limit, totalLines);
      const selectedLines = lines.slice(startLine, endLine);

      // 添加行号
      const numberedLines = selectedLines.map((line, i) => {
        const lineNum = (startLine + i + 1).toString().padStart(5, " ");
        return `${lineNum}│${line}`;
      });

      const result = numberedLines.join("\n");

      // 构建元数据
      let metadata = `📄 文件: ${file_path}
📊 总行数: ${totalLines} | 总大小: ${totalBytes} bytes
📍 显示: 第 ${startLine + 1} - ${endLine} 行 (共 ${selectedLines.length} 行)`;

      if (endLine < totalLines) {
        metadata += `\n💡 还有 ${totalLines - endLine} 行未显示，使用 offset=${endLine} 继续读取`;
      }

      log.toolEnd("Read", Date.now() - startTime, result.length);

      return `${metadata}\n${"─".repeat(60)}\n${result}`;
    } catch (error: any) {
      log.toolError("Read", error.message);
      return `读取失败: ${error.message}`;
    }
  },
  {
    name: "Read",
    description: `读取文件内容，返回带行号的内容。
- 支持分页读取大文件 (offset + limit)
- 默认读取前 200 行
- 返回文件元数据（总行数、大小等）`,
    schema: z.object({
      file_path: z.string().describe("文件路径（相对或绝对路径）"),
      offset: z.number().optional().describe("从第几行开始读取（0-indexed），默认 0"),
      limit: z.number().optional().describe("读取多少行，默认 200"),
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
      return `文件已写入: ${file_path}\n📊 ${lines} 行, ${bytes} bytes`;
    } catch (error: any) {
      log.toolError("Write", error.message);
      return `写入失败: ${error.message}`;
    }
  },
  {
    name: "Write",
    description: "写入内容到文件。如果文件存在会被覆盖，目录不存在会自动创建。",
    schema: z.object({
      file_path: z.string().describe("文件路径"),
      content: z.string().describe("要写入的内容"),
    }),
  }
);

// Glob 工具 - 文件模式匹配搜索
export const Glob = tool(
  async ({ pattern, path = "." }) => {
    const startTime = Date.now();
    log.toolStart("Glob", { pattern, path });

    try {
      const searchPath = resolve(process.cwd(), path);

      if (!existsSync(searchPath)) {
        log.toolError("Glob", `路径不存在: ${searchPath}`);
        return `错误: 路径不存在 - ${searchPath}`;
      }

      // 使用 glob 包进行文件匹配
      const files = await glob(pattern, {
        cwd: searchPath,
        nodir: true,           // 只匹配文件
        absolute: true,        // 返回绝对路径
        ignore: ["**/node_modules/**", "**/.git/**"], // 忽略常见目录
        maxDepth: pattern.includes("**") ? undefined : 10,
      });

      // 限制结果数量
      const limitedFiles = files.slice(0, 200);

      if (limitedFiles.length === 0) {
        log.toolEnd("Glob", Date.now() - startTime, 0);
        return `未找到匹配 "${pattern}" 的文件`;
      }

      const relativePaths = limitedFiles.map((f) => {
        const rel = relative(process.cwd(), f);
        try {
          const stat = statSync(f);
          const size = stat.isFile() ? ` (${stat.size} bytes)` : "/";
          return `${rel}${size}`;
        } catch {
          return rel;
        }
      });

      log.toolEnd("Glob", Date.now() - startTime, limitedFiles.length);

      let output = `找到 ${limitedFiles.length} 个匹配文件:\n\n`;
      output += relativePaths.join("\n");

      if (files.length > 200) {
        output += `\n\n⚠️ 结果已截断（共 ${files.length} 个，显示前 200 个）`;
      }

      return output;
    } catch (error: any) {
      log.toolError("Glob", error.message);
      return `搜索失败: ${error.message}`;
    }
  },
  {
    name: "Glob",
    description: `文件模式匹配搜索。
- 支持 glob 模式: *.ts, **/*.js, src/**/*.tsx
- 返回匹配的文件路径和大小
- 自动忽略 node_modules 和 .git 目录
- 最多返回 200 个结果`,
    schema: z.object({
      pattern: z.string().describe("glob 模式，如 *.ts, **/*.js, src/**/*.tsx"),
      path: z.string().optional().describe("搜索起始路径，默认当前目录"),
    }),
  }
);

// Grep 工具 - 使用 ripgrep 进行内容搜索
export const Grep = tool(
  async ({ pattern, path = ".", glob: globPattern, context = 0, ignore_case = false, max_results = 500 }) => {
    const startTime = Date.now();
    log.toolStart("Grep", { pattern, path, glob: globPattern, context, ignore_case, max_results });

    try {
      const searchPath = resolve(process.cwd(), path);

      if (!existsSync(searchPath)) {
        log.toolError("Grep", `路径不存在: ${searchPath}`);
        return `错误: 路径不存在 - ${searchPath}`;
      }

      // 构建 ripgrep 参数
      const args: string[] = [
        "--line-number",      // 显示行号
        "--no-heading",       // 不按文件分组，每行显示完整路径
        "--color=never",      // 禁用颜色输出
        `--max-count=${max_results}`, // 限制结果数量
      ];

      // 忽略大小写
      if (ignore_case) {
        args.push("--ignore-case");
      }

      // 上下文行数
      if (context > 0) {
        args.push(`--context=${context}`);
      }

      // 文件类型过滤
      if (globPattern) {
        args.push(`--glob=${globPattern}`);
      }

      // 排除目录（ripgrep 默认尊重 .gitignore，但我们显式排除常见目录）
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

      log.debug("Ripgrep command", { rgPath, args });

      // 使用 spawnSync 执行 ripgrep
      const result = spawnSync(rgPath, args, {
        encoding: "utf-8",
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 10, // 10MB
      });

      // ripgrep 返回码: 0=有匹配, 1=无匹配, 2=错误
      if (result.status === 2) {
        log.toolError("Grep", result.stderr || "Unknown error");
        return `搜索失败: ${result.stderr || "Unknown error"}`;
      }

      const output = result.stdout?.trim() || "";

      if (!output || result.status === 1) {
        log.toolEnd("Grep", Date.now() - startTime, 0);
        return `未找到匹配 "${pattern}" 的内容`;
      }

      // 将绝对路径转换为相对路径，使输出更简洁
      const cwd = process.cwd();
      const formattedOutput = output
        .split("\n")
        .map(line => {
          if (line.startsWith(cwd)) {
            return line.slice(cwd.length + 1); // +1 去掉开头的 /
          }
          return line;
        })
        .join("\n");

      // 检查输出大小
      if (formattedOutput.length > OUTPUT_THRESHOLD) {
        const metadata = writeToTempFile(formattedOutput, "grep_result");
        log.toolEnd("Grep", Date.now() - startTime, metadata.totalBytes);

        return `搜索完成。结果较大，已保存到临时文件。

📄 临时文件: ${metadata.tempFile}
📊 总行数: ${metadata.totalLines}
📦 总大小: ${metadata.totalBytes} bytes

预览 (前20行):
${metadata.preview}

使用 Read 工具查看完整结果: Read({ file_path: "${metadata.tempFile}", offset: 0, limit: 100 })`;
      }

      const lines = formattedOutput.split("\n");
      const durationMs = Date.now() - startTime;
      log.toolEnd("Grep", durationMs, formattedOutput.length);
      log.info("Grep search completed", {
        pattern,
        matchCount: lines.length,
        durationMs,
      });

      return `找到 ${lines.length} 处匹配:\n\n${formattedOutput}`;
    } catch (error: any) {
      log.toolError("Grep", error.message);
      return `搜索失败: ${error.message}`;
    }
  },
  {
    name: "Grep",
    description: `使用 ripgrep 在文件内容中搜索匹配的文本。
- 支持正则表达式（Rust regex 语法）
- 自动排除 node_modules, .git, dist, build 等目录
- 自动排除 lock 文件和压缩文件
- 可指定文件类型过滤 (glob 参数)
- 跨平台支持（Windows/macOS/Linux）
- 结果超过阈值会保存到临时文件`,
    schema: z.object({
      pattern: z.string().describe("搜索模式（支持正则表达式）"),
      path: z.string().optional().describe("搜索路径，默认当前目录"),
      glob: z.string().optional().describe("文件类型过滤，如 *.ts, *.js, *.{ts,tsx}"),
      context: z.number().optional().describe("显示匹配行前后的上下文行数，默认 0"),
      ignore_case: z.boolean().optional().describe("是否忽略大小写，默认 false"),
      max_results: z.number().optional().describe("最大结果数量，默认 500"),
    }),
  }
);

// Edit 工具 - 编辑文件（字符串替换）
export const Edit = tool(
  async ({ file_path, old_string, new_string }) => {
    const startTime = Date.now();
    log.toolStart("Edit", { file_path, oldLength: old_string.length, newLength: new_string.length });

    try {
      const absolutePath = resolve(process.cwd(), file_path);

      if (!existsSync(absolutePath)) {
        log.toolError("Edit", `文件不存在: ${file_path}`);
        return `错误: 文件不存在 - ${file_path}`;
      }

      const content = readFileSync(absolutePath, "utf-8");

      // 检查 old_string 是否存在
      if (!content.includes(old_string)) {
        log.toolError("Edit", `未找到要替换的内容`);
        return `错误: 未找到要替换的内容。请确保 old_string 完全匹配文件中的内容（包括空格和缩进）。`;
      }

      // 检查是否有多个匹配
      const matches = content.split(old_string).length - 1;
      if (matches > 1) {
        log.toolError("Edit", `找到 ${matches} 处匹配`);
        return `错误: 找到 ${matches} 处匹配，请提供更具体的上下文以确保唯一匹配。`;
      }

      // 执行替换
      const newContent = content.replace(old_string, new_string);
      writeFileSync(absolutePath, newContent, "utf-8");

      log.toolEnd("Edit", Date.now() - startTime, newContent.length);
      return `文件已编辑: ${file_path}\n替换了 ${old_string.split("\n").length} 行内容`;
    } catch (error: any) {
      log.toolError("Edit", error.message);
      return `编辑失败: ${error.message}`;
    }
  },
  {
    name: "Edit",
    description: `编辑文件，通过字符串替换修改内容。
- old_string 必须完全匹配文件中的内容（包括缩进）
- 只会替换第一处匹配
- 如果有多处匹配会报错，需要提供更多上下文`,
    schema: z.object({
      file_path: z.string().describe("文件路径"),
      old_string: z.string().describe("要替换的原始内容"),
      new_string: z.string().describe("替换后的新内容"),
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
        log.toolError("LS", `路径不存在: ${path}`);
        return `错误: 路径不存在 - ${path}`;
      }

      const stat = statSync(absolutePath);
      if (!stat.isDirectory()) {
        // 如果是文件，返回文件信息
        log.toolEnd("LS", Date.now() - startTime, 1);
        return `📄 ${path} (${stat.size} bytes, 修改时间: ${stat.mtime.toISOString()})`;
      }

      const items = readdirSync(absolutePath);
      const results: string[] = [];

      for (const item of items) {
        // 跳过隐藏文件（除非 all=true）
        if (!all && item.startsWith(".")) continue;

        const fullPath = join(absolutePath, item);
        try {
          const itemStat = statSync(fullPath);
          if (itemStat.isDirectory()) {
            results.push(`📁 ${item}/`);
          } else {
            const size = itemStat.size;
            const sizeStr = size > 1024 * 1024
              ? `${(size / 1024 / 1024).toFixed(1)}MB`
              : size > 1024
                ? `${(size / 1024).toFixed(1)}KB`
                : `${size}B`;
            results.push(`📄 ${item} (${sizeStr})`);
          }
        } catch {
          results.push(`❓ ${item} (无法访问)`);
        }
      }

      log.toolEnd("LS", Date.now() - startTime, results.length);

      if (results.length === 0) {
        return `目录为空: ${path}`;
      }

      return `📂 ${path} (${results.length} 项)\n${"─".repeat(40)}\n${results.join("\n")}`;
    } catch (error: any) {
      log.toolError("LS", error.message);
      return `列出失败: ${error.message}`;
    }
  },
  {
    name: "LS",
    description: "列出目录内容，显示文件和子目录。",
    schema: z.object({
      path: z.string().optional().describe("目录路径，默认当前目录"),
      all: z.boolean().optional().describe("是否显示隐藏文件，默认 false"),
    }),
  }
);
