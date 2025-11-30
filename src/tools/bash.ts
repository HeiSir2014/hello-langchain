import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { log } from "../logger";

// 输出大小阈值（超过此大小写入临时文件）
const OUTPUT_THRESHOLD = 4000;

// 临时文件目录
const TEMP_DIR = join(tmpdir(), "langgraph-tools");

// 确保临时目录存在
function ensureTempDir(): void {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }
}

// 生成临时文件路径
function getTempFilePath(prefix: string): string {
  ensureTempDir();
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return join(TEMP_DIR, `${prefix}_${timestamp}_${random}.txt`);
}

// 输出元数据接口
interface OutputMetadata {
  tempFile: string;
  totalLines: number;
  totalBytes: number;
  preview: string;
}

// 将大输出写入临时文件
function writeToTempFile(content: string, prefix: string): OutputMetadata {
  const tempFile = getTempFilePath(prefix);
  writeFileSync(tempFile, content, "utf-8");

  const lines = content.split("\n");
  const previewLines = lines.slice(0, 20);
  const preview = previewLines.join("\n") + (lines.length > 20 ? "\n..." : "");

  return {
    tempFile,
    totalLines: lines.length,
    totalBytes: Buffer.byteLength(content, "utf-8"),
    preview,
  };
}

// Bash 工具 - 执行 shell 命令
export const Bash = tool(
  async ({ command, timeout = 30000 }) => {
    const startTime = Date.now();
    log.toolStart("Bash", { command, timeout });

    try {
      const result = execSync(command, {
        encoding: "utf-8",
        timeout,
        maxBuffer: 1024 * 1024 * 50, // 50MB
        cwd: process.cwd(),
        shell: "/bin/bash",
      });

      const output = result.trim();
      const durationMs = Date.now() - startTime;

      if (!output) {
        log.toolEnd("Bash", durationMs, 0);
        return "(命令执行成功，无输出)";
      }

      // 检查输出大小
      if (output.length > OUTPUT_THRESHOLD) {
        const metadata = writeToTempFile(output, "bash_output");
        log.toolEnd("Bash", durationMs, metadata.totalBytes);

        return `命令执行成功。输出较大，已保存到临时文件。

📄 临时文件: ${metadata.tempFile}
📊 总行数: ${metadata.totalLines}
📦 总大小: ${metadata.totalBytes} bytes

预览 (前20行):
${metadata.preview}

使用 Read 工具读取完整内容: Read({ file_path: "${metadata.tempFile}", offset: 0, limit: 100 })`;
      }

      log.toolEnd("Bash", durationMs, output.length);
      return output;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      // 处理命令执行错误
      const stdout = error.stdout?.toString() || "";
      const stderr = error.stderr?.toString() || "";
      const exitCode = error.status || 1;

      let errorOutput = `命令执行失败 (退出码: ${exitCode})\n`;

      if (stderr) {
        if (stderr.length > OUTPUT_THRESHOLD) {
          const metadata = writeToTempFile(stderr, "bash_stderr");
          errorOutput += `\n标准错误输出已保存到: ${metadata.tempFile}\n预览: ${metadata.preview.slice(0, 500)}`;
        } else {
          errorOutput += `\n标准错误:\n${stderr}`;
        }
      }

      if (stdout) {
        if (stdout.length > OUTPUT_THRESHOLD) {
          const metadata = writeToTempFile(stdout, "bash_stdout");
          errorOutput += `\n标准输出已保存到: ${metadata.tempFile}`;
        } else {
          errorOutput += `\n标准输出:\n${stdout}`;
        }
      }

      log.toolError("Bash", `Exit code: ${exitCode}, duration: ${durationMs}ms, stderr: ${stderr.slice(0, 200)}`);
      return errorOutput;
    }
  },
  {
    name: "Bash",
    description: `执行 shell 命令。用于运行系统命令、脚本等操作。
- 如果输出超过 ${OUTPUT_THRESHOLD} 字符，会保存到临时文件
- 返回临时文件路径和元数据，可用 Read 工具查看完整内容
- 支持管道、重定向等 bash 特性`,
    schema: z.object({
      command: z.string().describe("要执行的 shell 命令"),
      timeout: z.coerce.number().optional().describe("超时时间（毫秒），默认 30000"),
    }),
  }
);

// 导出临时目录路径供其他工具使用
export { TEMP_DIR, getTempFilePath, writeToTempFile, OUTPUT_THRESHOLD };
