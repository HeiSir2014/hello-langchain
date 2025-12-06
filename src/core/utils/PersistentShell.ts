/**
 * PersistentShell
 *
 * Provides a persistent shell session that maintains state across commands.
 * Supports cancellation via AbortSignal.
 */
import * as fs from 'fs';
import { existsSync } from 'fs';
import { spawn, execSync, execFileSync, type ChildProcess } from 'child_process';
import { isAbsolute, resolve, join } from 'path';
import { tmpdir } from 'os';
import { log } from '../../logger.js';

export type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  interrupted: boolean;
};

// Callback for streaming output
export type OutputCallback = (stdout: string, stderr: string) => void;

type QueuedCommand = {
  command: string;
  abortSignal?: AbortSignal;
  timeout?: number;
  onOutput?: OutputCallback;
  resolve: (result: ExecResult) => void;
  reject: (error: Error) => void;
};

const PRODUCT_COMMAND = 'yterm';
const TEMPFILE_PREFIX = tmpdir() + `/${PRODUCT_COMMAND}-`;
const DEFAULT_TIMEOUT = 30 * 60 * 1000;
const SIGTERM_CODE = 143;
const FILE_SUFFIXES = {
  STATUS: '-status',
  STDOUT: '-stdout',
  STDERR: '-stderr',
  CWD: '-cwd',
};

type DetectedShell = {
  bin: string;
  args: string[];
  type: 'posix' | 'msys' | 'wsl';
};

function quoteForBash(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

function toBashPath(pathStr: string, type: 'posix' | 'msys' | 'wsl'): string {
  if (pathStr.startsWith('/')) return pathStr;
  if (type === 'posix') return pathStr;

  const normalized = pathStr.replace(/\\/g, '/').replace(/\\\\/g, '/');
  const driveMatch = /^[A-Za-z]:/.exec(normalized);
  if (driveMatch) {
    const drive = normalized[0].toLowerCase();
    const rest = normalized.slice(2);
    if (type === 'msys') {
      return `/` + drive + (rest.startsWith('/') ? rest : `/${rest}`);
    }
    return `/mnt/` + drive + (rest.startsWith('/') ? rest : `/${rest}`);
  }
  return normalized;
}

function splitPathEntries(pathEnv: string, platform: NodeJS.Platform): string[] {
  if (!pathEnv) return [];

  if (platform !== 'win32') {
    return pathEnv
      .split(':')
      .map(s => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  }

  const entries: string[] = [];
  let current = '';
  const pushCurrent = () => {
    const cleaned = current.trim().replace(/^"|"$/g, '');
    if (cleaned) entries.push(cleaned);
    current = '';
  };

  for (let i = 0; i < pathEnv.length; i++) {
    const ch = pathEnv[i];

    if (ch === ';') {
      pushCurrent();
      continue;
    }

    if (ch === ':') {
      const segmentLength = current.length;
      const firstChar = current[0];
      const isDriveLetterPrefix = segmentLength === 1 && /[A-Za-z]/.test(firstChar || '');
      if (!isDriveLetterPrefix) {
        pushCurrent();
        continue;
      }
    }

    current += ch;
  }

  pushCurrent();
  return entries;
}

function detectShell(): DetectedShell {
  const isWin = process.platform === 'win32';
  if (!isWin) {
    const bin = process.env.SHELL || '/bin/bash';
    return { bin, args: ['-l'], type: 'posix' };
  }

  if (process.env.SHELL && /bash\.exe$/i.test(process.env.SHELL) && existsSync(process.env.SHELL)) {
    return { bin: process.env.SHELL, args: [], type: 'msys' };
  }

  if (process.env.YTERM_BASH && existsSync(process.env.YTERM_BASH)) {
    return { bin: process.env.YTERM_BASH, args: [], type: 'msys' };
  }

  const programFiles = [
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env['ProgramW6432'],
  ].filter(Boolean) as string[];

  const localAppData = process.env['LocalAppData'];

  const candidates: string[] = [];
  for (const base of programFiles) {
    candidates.push(
      join(base, 'Git', 'bin', 'bash.exe'),
      join(base, 'Git', 'usr', 'bin', 'bash.exe'),
    );
  }
  if (localAppData) {
    candidates.push(
      join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
      join(localAppData, 'Programs', 'Git', 'usr', 'bin', 'bash.exe'),
    );
  }
  candidates.push('C:/msys64/usr/bin/bash.exe');

  for (const c of candidates) {
    if (existsSync(c)) {
      return { bin: c, args: [], type: 'msys' };
    }
  }

  const pathEnv = process.env.PATH || process.env.Path || process.env.path || '';
  const pathEntries = splitPathEntries(pathEnv, process.platform);
  for (const p of pathEntries) {
    const candidate = join(p, 'bash.exe');
    if (existsSync(candidate)) {
      return { bin: candidate, args: [], type: 'msys' };
    }
  }

  try {
    execSync('wsl.exe -e bash -lc "echo YTERM_OK"', { stdio: 'ignore', timeout: 1500 });
    return { bin: 'wsl.exe', args: ['-e', 'bash', '-l'], type: 'wsl' };
  } catch {}

  const hint = [
    '无法找到可用的 bash。请安装 Git for Windows 或启用 WSL。',
    '推荐安装 Git: https://git-scm.com/download/win',
    '或启用 WSL 并安装 Ubuntu: https://learn.microsoft.com/windows/wsl/install',
  ].join('\n');
  throw new Error(hint);
}

export class PersistentShell {
  private commandQueue: QueuedCommand[] = [];
  private isExecuting: boolean = false;
  private shell: ChildProcess;
  private isAlive: boolean = true;
  private commandInterrupted: boolean = false;
  private statusFile: string;
  private stdoutFile: string;
  private stderrFile: string;
  private cwdFile: string;
  private cwd: string;
  private binShell: string;
  private shellArgs: string[];
  private shellType: 'posix' | 'msys' | 'wsl';
  private statusFileBashPath: string;
  private stdoutFileBashPath: string;
  private stderrFileBashPath: string;
  private cwdFileBashPath: string;

  constructor(cwd: string) {
    const { bin, args, type } = detectShell();
    this.binShell = bin;
    this.shellArgs = args;
    this.shellType = type;

    this.shell = spawn(this.binShell, this.shellArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: {
        ...process.env,
        GIT_EDITOR: 'true',
      },
    });

    this.cwd = cwd;

    this.shell.on('exit', (code, signal) => {
      if (code) {
        log.error(`Shell exited with code ${code} and signal ${signal}`);
      }
      for (const file of [
        this.statusFile,
        this.stdoutFile,
        this.stderrFile,
        this.cwdFile,
      ]) {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      }
      this.isAlive = false;
    });

    const id = Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');

    this.statusFile = TEMPFILE_PREFIX + id + FILE_SUFFIXES.STATUS;
    this.stdoutFile = TEMPFILE_PREFIX + id + FILE_SUFFIXES.STDOUT;
    this.stderrFile = TEMPFILE_PREFIX + id + FILE_SUFFIXES.STDERR;
    this.cwdFile = TEMPFILE_PREFIX + id + FILE_SUFFIXES.CWD;
    for (const file of [this.statusFile, this.stdoutFile, this.stderrFile]) {
      fs.writeFileSync(file, '');
    }
    fs.writeFileSync(this.cwdFile, cwd);

    this.statusFileBashPath = toBashPath(this.statusFile, this.shellType);
    this.stdoutFileBashPath = toBashPath(this.stdoutFile, this.shellType);
    this.stderrFileBashPath = toBashPath(this.stderrFile, this.shellType);
    this.cwdFileBashPath = toBashPath(this.cwdFile, this.shellType);

    if (this.shellType === 'msys') {
      this.sendToShell('[ -f ~/.bashrc ] && source ~/.bashrc || true');
      this.sendToShell(`pwd -W > ${quoteForBash(this.cwdFileBashPath)}`);
    } else {
      this.sendToShell('[ -f ~/.bashrc ] && source ~/.bashrc || true');
    }
  }

  private static instance: PersistentShell | null = null;

  static restart() {
    if (PersistentShell.instance) {
      PersistentShell.instance.close();
      PersistentShell.instance = null;
    }
  }

  static getInstance(): PersistentShell {
    if (!PersistentShell.instance || !PersistentShell.instance.isAlive) {
      PersistentShell.instance = new PersistentShell(process.cwd());
    }
    return PersistentShell.instance;
  }

  killChildren() {
    const parentPid = this.shell.pid;
    try {
      const childPids = execSync(`pgrep -P ${parentPid}`)
        .toString()
        .trim()
        .split('\n')
        .filter(Boolean);

      childPids.forEach(pid => {
        try {
          process.kill(Number(pid), 'SIGTERM');
        } catch (error) {
          log.error(`Failed to kill process ${pid}: ${error}`);
        }
      });
    } catch {
      // pgrep returns non-zero when no processes are found
    } finally {
      this.commandInterrupted = true;
    }
  }

  private async processQueue() {
    if (this.isExecuting || this.commandQueue.length === 0) return;

    this.isExecuting = true;
    const { command, abortSignal, timeout, onOutput, resolve, reject } =
      this.commandQueue.shift()!;

    const killChildren = () => this.killChildren();
    if (abortSignal) {
      abortSignal.addEventListener('abort', killChildren);
    }

    try {
      const result = await this.exec_(command, timeout, onOutput);
      resolve(result);
    } catch (error) {
      reject(error as Error);
    } finally {
      this.isExecuting = false;
      if (abortSignal) {
        abortSignal.removeEventListener('abort', killChildren);
      }
      this.processQueue();
    }
  }

  async exec(
    command: string,
    abortSignal?: AbortSignal,
    timeout?: number,
    onOutput?: OutputCallback,
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ command, abortSignal, timeout, onOutput, resolve, reject });
      this.processQueue();
    });
  }

  private async exec_(command: string, timeout?: number, onOutput?: OutputCallback): Promise<ExecResult> {
    const quotedCommand = quoteForBash(command);

    // Check syntax
    try {
      if (this.shellType === 'wsl') {
        execFileSync('wsl.exe', ['-e', 'bash', '-n', '-c', command], {
          stdio: 'ignore',
          timeout: 1000,
        });
      } else if (this.shellType === 'msys') {
        execFileSync(this.binShell, ['-n', '-c', command], {
          stdio: 'ignore',
          timeout: 1000,
        });
      } else {
        execSync(`${this.binShell} -n -c ${quotedCommand}`, {
          stdio: 'ignore',
          timeout: 1000,
        });
      }
    } catch (error) {
      const execError = error as any;
      const actualExitCode = execError?.status ?? execError?.code ?? 2;
      const errorStr = execError?.stderr?.toString() || execError?.message || String(error || '');

      return Promise.resolve({
        stdout: '',
        stderr: errorStr,
        code: actualExitCode,
        interrupted: false,
      });
    }

    const commandTimeout = timeout || DEFAULT_TIMEOUT;
    this.commandInterrupted = false;

    return new Promise<ExecResult>(resolve => {
      fs.writeFileSync(this.stdoutFile, '');
      fs.writeFileSync(this.stderrFile, '');
      fs.writeFileSync(this.statusFile, '');

      const commandParts = [];
      commandParts.push(
        `eval ${quotedCommand} < /dev/null > ${quoteForBash(this.stdoutFileBashPath)} 2> ${quoteForBash(this.stderrFileBashPath)}`,
      );
      commandParts.push(`EXEC_EXIT_CODE=$?`);

      if (this.shellType === 'msys') {
        commandParts.push(`pwd -W > ${quoteForBash(this.cwdFileBashPath)}`);
      } else {
        commandParts.push(`pwd > ${quoteForBash(this.cwdFileBashPath)}`);
      }

      commandParts.push(`echo $EXEC_EXIT_CODE > ${quoteForBash(this.statusFileBashPath)}`);

      this.sendToShell(commandParts.join('\n'));

      const start = Date.now();
      let lastStdoutLength = 0;
      let lastStderrLength = 0;
      let lastOutputTime = Date.now();
      const OUTPUT_INTERVAL = 100; // Emit output every 100ms at most

      const checkCompletion = setInterval(() => {
        try {
          let statusFileSize = 0;
          if (fs.existsSync(this.statusFile)) {
            statusFileSize = fs.statSync(this.statusFile).size;
          }

          // Read current output for streaming
          const currentStdout = fs.existsSync(this.stdoutFile)
            ? fs.readFileSync(this.stdoutFile, 'utf8')
            : '';
          const currentStderr = fs.existsSync(this.stderrFile)
            ? fs.readFileSync(this.stderrFile, 'utf8')
            : '';

          // Emit output callback if there's new content and enough time has passed
          const now = Date.now();
          if (onOutput && (now - lastOutputTime >= OUTPUT_INTERVAL)) {
            if (currentStdout.length > lastStdoutLength || currentStderr.length > lastStderrLength) {
              onOutput(currentStdout, currentStderr);
              lastStdoutLength = currentStdout.length;
              lastStderrLength = currentStderr.length;
              lastOutputTime = now;
            }
          }

          if (
            statusFileSize > 0 ||
            Date.now() - start > commandTimeout ||
            this.commandInterrupted
          ) {
            clearInterval(checkCompletion);
            const stdout = currentStdout;
            let stderr = currentStderr;
            let code: number;

            if (statusFileSize) {
              // Command completed normally
              code = Number(fs.readFileSync(this.statusFile, 'utf8'));
            } else if (this.commandInterrupted) {
              // Command was interrupted by user
              code = SIGTERM_CODE;
              stderr += (stderr ? '\n' : '') + '<interrupted>Command was interrupted by user</interrupted>';
            } else {
              // Command timed out
              this.killChildren();
              code = SIGTERM_CODE;
              stderr += (stderr ? '\n' : '') + 'Command execution timed out';
            }

            // Final output callback
            if (onOutput && (stdout.length > lastStdoutLength || stderr.length > lastStderrLength)) {
              onOutput(stdout, stderr);
            }

            resolve({
              stdout,
              stderr,
              code,
              interrupted: this.commandInterrupted,
            });
          }
        } catch {
          // Ignore file system errors during polling
        }
      }, 10);
    });
  }

  private sendToShell(command: string) {
    try {
      this.shell!.stdin!.write(command + '\n');
    } catch (error) {
      const errorString =
        error instanceof Error
          ? error.message
          : String(error || 'Unknown error');
      log.error(`Error in sendToShell: ${errorString}`);
      throw error;
    }
  }

  pwd(): string {
    try {
      const newCwd = fs.readFileSync(this.cwdFile, 'utf8').trim();
      if (newCwd) {
        this.cwd = newCwd;
      }
    } catch (error) {
      log.error(`Shell pwd error ${error}`);
    }
    return this.cwd;
  }

  async setCwd(cwd: string) {
    const resolved = isAbsolute(cwd) ? cwd : resolve(process.cwd(), cwd);
    if (!existsSync(resolved)) {
      throw new Error(`Path "${resolved}" does not exist`);
    }
    const bashPath = toBashPath(resolved, this.shellType);
    await this.exec(`cd ${quoteForBash(bashPath)}`);
  }

  close(): void {
    this.shell!.stdin!.end();
    this.shell.kill();
  }
}
