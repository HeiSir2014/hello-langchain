import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { spawn, execSync, ChildProcess } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as iconv from "iconv-lite";
import { log } from "../logger.js";

// 输出大小阈值（超过此大小写入临时文件）
const OUTPUT_THRESHOLD = 30000;

// 临时文件目录
const TEMP_DIR = join(tmpdir(), "langgraph-tools");

// Windows 系统检测
const IS_WINDOWS = process.platform === "win32";

// Git Bash 路径检测
function findGitBash(): string | null {
  if (!IS_WINDOWS) return null;

  const possiblePaths = [
    process.env.GIT_BASH_PATH,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
    `${process.env.ProgramFiles}\\Git\\bin\\bash.exe`,
    `${process.env["ProgramFiles(x86)"]}\\Git\\bin\\bash.exe`,
  ].filter(Boolean) as string[];

  for (const path of possiblePaths) {
    try {
      if (require("fs").existsSync(path)) {
        return path;
      }
    } catch {
      continue;
    }
  }
  return null;
}

// 获取 Windows 上的 shell（优先使用 Git Bash）
const GIT_BASH_PATH = findGitBash();
const WINDOWS_SHELL = GIT_BASH_PATH || "cmd.exe";
const USE_GIT_BASH = IS_WINDOWS && GIT_BASH_PATH !== null;

// 后台运行的 shell 进程
const backgroundShells = new Map<string, {
  process: ChildProcess;
  stdout: string;
  stderr: string;
  status: "running" | "completed" | "error";
  exitCode: number | null;
}>();

// 检测 Buffer 是否为有效的 UTF-8
function isValidUtf8(buffer: Buffer): boolean {
  try {
    const str = buffer.toString("utf-8");
    if (str.includes("\uFFFD")) {
      return false;
    }
    const reEncoded = Buffer.from(str, "utf-8");
    return buffer.equals(reEncoded);
  } catch {
    return false;
  }
}

// 智能解码 Buffer（自动检测 UTF-8 或 GBK）
function smartDecode(buffer: Buffer): string {
  if (!buffer || buffer.length === 0) {
    return "";
  }

  if (isValidUtf8(buffer)) {
    return buffer.toString("utf-8");
  }

  if (IS_WINDOWS) {
    try {
      return iconv.decode(buffer, "cp936");
    } catch {
      return buffer.toString("utf-8");
    }
  }

  return buffer.toString("utf-8");
}

// 解码 Buffer 为字符串
function decodeBuffer(buffer: Buffer | string | undefined): string {
  if (!buffer) return "";
  if (typeof buffer === "string") return buffer;
  return smartDecode(buffer);
}

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

// 生成唯一的 shell ID
function generateShellId(): string {
  return `shell_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  async ({ command, timeout = 120000, description, run_in_background = false }) => {
    const startTime = Date.now();
    log.toolStart("Bash", { command, timeout, description, run_in_background });

    // 后台运行模式
    if (run_in_background) {
      const shellId = generateShellId();

      // Windows: 优先使用 Git Bash，否则 cmd.exe
      // Unix: 使用 /bin/bash
      const shell = IS_WINDOWS ? WINDOWS_SHELL : "/bin/bash";
      const shellArgs = USE_GIT_BASH ? ["-c", command] : (IS_WINDOWS ? ["/c", command] : ["-c", command]);

      const childProcess = spawn(shell, shellArgs, {
        cwd: process.cwd(),
        env: process.env,
      });

      const shellData: {
        process: ChildProcess;
        stdout: string;
        stderr: string;
        status: "running" | "completed" | "error";
        exitCode: number | null;
      } = {
        process: childProcess,
        stdout: "",
        stderr: "",
        status: "running",
        exitCode: null,
      };

      backgroundShells.set(shellId, shellData);

      childProcess.stdout?.on("data", (data: Buffer) => {
        shellData.stdout += smartDecode(data);
      });

      childProcess.stderr?.on("data", (data: Buffer) => {
        shellData.stderr += smartDecode(data);
      });

      childProcess.on("close", (code) => {
        shellData.status = code === 0 ? "completed" : "error";
        shellData.exitCode = code;
      });

      childProcess.on("error", (err) => {
        shellData.status = "error";
        shellData.stderr += err.message;
      });

      log.info("Background shell started", { shellId, command });
      return `Background shell started with ID: ${shellId}\nUse BashOutput tool to check output.`;
    }

    // 前台运行模式
    try {
      // Windows: 优先使用 Git Bash
      // Git Bash 输出通常是 UTF-8，cmd.exe 可能是 GBK
      const shellToUse = IS_WINDOWS ? WINDOWS_SHELL : "/bin/bash";
      const useUtf8 = USE_GIT_BASH || !IS_WINDOWS;

      const result = execSync(command, {
        encoding: useUtf8 ? "utf-8" : "buffer",
        timeout: Math.min(timeout, 600000), // 最大 10 分钟
        maxBuffer: 1024 * 1024 * 50, // 50MB
        cwd: process.cwd(),
        shell: shellToUse,
      });

      const output = decodeBuffer(result as Buffer | string).trim();
      const durationMs = Date.now() - startTime;

      if (!output) {
        log.toolEnd("Bash", durationMs, 0);
        return "(命令执行成功，无输出)";
      }

      // 检查输出大小
      if (output.length > OUTPUT_THRESHOLD) {
        const metadata = writeToTempFile(output, "bash_output");
        log.toolEnd("Bash", durationMs, metadata.totalBytes);

        return `命令执行成功。输出较大 (${metadata.totalBytes} bytes)，已保存到临时文件。

临时文件: ${metadata.tempFile}
总行数: ${metadata.totalLines}

预览 (前20行):
${metadata.preview}

使用 Read 工具读取完整内容: Read({ file_path: "${metadata.tempFile}" })`;
      }

      log.toolEnd("Bash", durationMs, output.length);
      return output;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const stdout = decodeBuffer(error.stdout);
      const stderr = decodeBuffer(error.stderr);
      const exitCode = error.status || 1;

      let errorOutput = `命令执行失败 (退出码: ${exitCode})\n`;

      if (stderr) {
        if (stderr.length > OUTPUT_THRESHOLD) {
          const metadata = writeToTempFile(stderr, "bash_stderr");
          errorOutput += `\n标准错误已保存到: ${metadata.tempFile}\n预览: ${metadata.preview.slice(0, 500)}`;
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

      log.toolError("Bash", `Exit code: ${exitCode}, duration: ${durationMs}ms`);
      return errorOutput;
    }
  },
  {
    name: "Bash",
    description: `Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`ls\` to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use \`ls foo\` to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., cd "path with spaces/file.txt")
   - Examples of proper quoting:
     - cd "/Users/name/My Documents" (correct)
     - cd /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). If not specified, commands will timeout after 120000ms (2 minutes).
  - It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
  - If the output exceeds ${OUTPUT_THRESHOLD} characters, output will be truncated before being returned to you.
  - You can use the \`run_in_background\` parameter to run the command in the background, which allows you to continue working while the command runs. You can monitor the output using the BashOutput tool as it becomes available. You do not need to use '&' at the end of the command when using this parameter.

  - Avoid using Bash with the \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:
    - File search: Use Glob (NOT find or ls)
    - Content search: Use Grep (NOT grep or rg)
    - Read files: Use Read (NOT cat/head/tail)
    - Edit files: Use Edit (NOT sed/awk)
    - Write files: Use Write (NOT echo >/cat <<EOF)
    - Communication: Output text directly (NOT echo/printf)
  - When issuing multiple commands:
    - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two Bash tool calls in parallel.
    - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., \`git add . && git commit -m "message" && git push\`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.
    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)
  - Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of \`cd\`. You may use \`cd\` if the User explicitly requests it.
  - Current shell: ${IS_WINDOWS ? (USE_GIT_BASH ? "Git Bash" : "cmd.exe") : process.env.SHELL || "/bin/bash"}
  - Platform: ${process.platform}${USE_GIT_BASH ? " (Git Bash detected)" : ""}`,
    schema: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.coerce.number().optional().describe("Optional timeout in milliseconds (max 600000)"),
      description: z.string().optional().describe("Clear, concise description of what this command does in 5-10 words, in active voice. Examples:\nInput: ls\nOutput: List files in current directory\n\nInput: git status\nOutput: Show working tree status\n\nInput: npm install\nOutput: Install package dependencies\n\nInput: mkdir foo\nOutput: Create directory 'foo'"),
      run_in_background: z.coerce.boolean().optional().describe("Set to true to run this command in the background. Use BashOutput to read the output later."),
    }),
  }
);

// BashOutput 工具 - 获取后台 shell 的输出
export const BashOutput = tool(
  async ({ bash_id, filter }) => {
    const startTime = Date.now();
    log.toolStart("BashOutput", { bash_id, filter });

    const shellData = backgroundShells.get(bash_id);
    if (!shellData) {
      log.toolError("BashOutput", `Shell not found: ${bash_id}`);
      return `Error: Shell with ID "${bash_id}" not found.`;
    }

    let output = "";
    if (shellData.stdout) {
      output += shellData.stdout;
    }
    if (shellData.stderr) {
      output += (output ? "\n" : "") + "STDERR:\n" + shellData.stderr;
    }

    // 应用过滤器
    if (filter && output) {
      try {
        const regex = new RegExp(filter, "gm");
        const lines = output.split("\n").filter(line => regex.test(line));
        output = lines.join("\n");
      } catch (e: any) {
        return `Error: Invalid filter regex - ${e.message}`;
      }
    }

    const status = shellData.status;
    const exitCode = shellData.exitCode;

    log.toolEnd("BashOutput", Date.now() - startTime, output.length);

    return `Status: ${status}${exitCode !== null ? ` (exit code: ${exitCode})` : ""}\n\n${output || "(no output yet)"}`;
  },
  {
    name: "BashOutput",
    description: `Retrieves output from a running or completed background bash shell.

- Takes a bash_id parameter identifying the shell
- Always returns only new output since the last check
- Returns stdout and stderr output along with shell status
- Supports optional regex filtering to show only lines matching a pattern
- Use this tool when you need to monitor or check the output of a long-running shell
- Shell IDs can be found using the /tasks command`,
    schema: z.object({
      bash_id: z.string().describe("The ID of the background shell to retrieve output from"),
      filter: z.string().optional().describe("Optional regular expression to filter the output lines. Only lines matching this regex will be included in the result. Any lines that do not match will no longer be available to read."),
    }),
  }
);

// KillShell 工具 - 终止后台 shell
export const KillShell = tool(
  async ({ shell_id }) => {
    const startTime = Date.now();
    log.toolStart("KillShell", { shell_id });

    const shellData = backgroundShells.get(shell_id);
    if (!shellData) {
      log.toolError("KillShell", `Shell not found: ${shell_id}`);
      return `Error: Shell with ID "${shell_id}" not found.`;
    }

    if (shellData.status === "running") {
      shellData.process.kill();
      shellData.status = "error";
    }

    backgroundShells.delete(shell_id);

    log.toolEnd("KillShell", Date.now() - startTime, 0);
    return `Shell "${shell_id}" has been terminated.`;
  },
  {
    name: "KillShell",
    description: `Kills a running background bash shell by its ID.

- Takes a shell_id parameter identifying the shell to kill
- Returns a success or failure status
- Use this tool when you need to terminate a long-running shell
- Shell IDs can be found using the /tasks command`,
    schema: z.object({
      shell_id: z.string().describe("The ID of the background shell to kill"),
    }),
  }
);

// 导出临时目录路径供其他工具使用
export { TEMP_DIR, getTempFilePath, writeToTempFile, OUTPUT_THRESHOLD };
