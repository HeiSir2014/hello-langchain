#!/usr/bin/env bun
/**
 * Build script for YTerm
 *
 * This script handles:
 * 1. Bundle the project using Bun
 * 2. Create single executable using Bun's native compile feature
 *
 * Usage:
 *   bun run scripts/build.ts              # Bundle only
 *   bun run scripts/build.ts --compile    # Compile to single executable
 *   bun run scripts/build.ts --cross      # Cross-compile for all platforms
 */

import { $ } from "bun";
import { existsSync, mkdirSync, rmSync, copyFileSync, chmodSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

// Load environment variables from .env.local
const envLocalPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
config({ path: envLocalPath, override: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");
const BUILD_DIR = join(ROOT_DIR, "build");
const BIN_DIR = join(BUILD_DIR, "bin");

// Parse arguments
const args = process.argv.slice(2);
const compileExecutable = args.includes("--compile");
const crossCompile = args.includes("--cross");
const platform = process.platform;
const arch = process.arch;

// Cross-compile targets (bun uses "bun-<os>-<arch>" format)
const TARGETS = [
  { name: "darwin-arm64", bunTarget: "bun-darwin-arm64" },
  { name: "darwin-x64", bunTarget: "bun-darwin-x64" },
  { name: "linux-arm64", bunTarget: "bun-linux-arm64" },
  { name: "linux-x64", bunTarget: "bun-linux-x64" },
  { name: "windows-x64", bunTarget: "bun-windows-x64" },
] as const;

console.log("🚀 YTerm Build Script");
console.log(`   Platform: ${platform}-${arch}`);
console.log(`   Mode: ${crossCompile ? "Cross-compile all" : compileExecutable ? "Compile executable" : "Bundle only"}`);
console.log("");

async function cleanDirs() {
  console.log("🧹 Cleaning build directories...");

  if (existsSync(BUILD_DIR)) {
    rmSync(BUILD_DIR, { recursive: true });
  }
  mkdirSync(BUILD_DIR, { recursive: true });

  if (compileExecutable || crossCompile) {
    mkdirSync(BIN_DIR, { recursive: true });
  }
}

async function bundle() {
  console.log("📦 Bundling with Bun...");

  const entryPoint = join(ROOT_DIR, "src/cli.tsx");
  const outFile = join(BUILD_DIR, "yterm.js");

  const result = await Bun.build({
    entrypoints: [entryPoint],
    outdir: BUILD_DIR,
    naming: "yterm.js",
    target: "bun",
    format: "esm",
    minify: {
      whitespace: true,
      syntax: true,
      identifiers: false, // Keep identifiers for better error messages
    },
    sourcemap: "external",
    external: [
      // Native modules that can't be bundled
      "@vscode/ripgrep",
      // Dev dependencies not needed in production
      "react-devtools-core",
    ],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });

  if (!result.success) {
    console.error("❌ Bundle failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Add shebang to the output file
  const bundleContent = readFileSync(outFile, "utf-8");
  writeFileSync(outFile, `#!/usr/bin/env bun\n${bundleContent}`);
  chmodSync(outFile, 0o755);

  const { size } = Bun.file(outFile);
  const sizeMB = (size / 1024 / 1024).toFixed(2);
  console.log(`   ✅ Bundle created: ${outFile} (${sizeMB} MB)`);

  // Copy package.json with minimal fields for external dependencies
  const pkg = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf-8"));
  const minimalPkg = {
    name: pkg.name,
    version: pkg.version,
    type: "module",
    main: "yterm.js",
    bin: {
      yterm: "./yterm.js"
    },
    dependencies: {
      "@vscode/ripgrep": pkg.dependencies["@vscode/ripgrep"],
    }
  };
  writeFileSync(join(BUILD_DIR, "package.json"), JSON.stringify(minimalPkg, null, 2));
  console.log("   ✅ Created minimal package.json for external dependencies");

  return outFile;
}

async function compileForTarget(targetInfo?: { name: string; bunTarget: string }) {
  const entryPoint = join(ROOT_DIR, "src/cli.tsx");
  const targetName = targetInfo?.name || `${platform}-${arch}`;
  const bunTarget = targetInfo?.bunTarget;
  const exeName = targetName.startsWith("windows") ? "yterm.exe" : "yterm";
  const outFile = join(BIN_DIR, targetName, exeName);

  // Create target directory
  mkdirSync(dirname(outFile), { recursive: true });

  console.log(`   ⏳ Compiling for ${targetName}...`);

  // 显示使用的环境变量配置
  console.log(`   📋 Environment Configuration:`);
  console.log(`      Provider: ${process.env.USE_PROVIDER || "OLLAMA"}`);
  if (process.env.USE_PROVIDER === "ANTHROPIC") {
    console.log(`      Anthropic Model: ${process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-20250514"}`);
    console.log(`      Anthropic API: ${process.env.ANTHROPIC_API_KEY ? "✓ Configured" : "✗ Not configured"}`);
    console.log(`      Anthropic Base URL: ${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}`);
  } else if (process.env.USE_PROVIDER === "OPENAI") {
    console.log(`      OpenAI Model: ${process.env.OPENAI_MODEL_NAME || "gpt-4o"}`);
    console.log(`      OpenAI API: ${process.env.OPENAI_API_KEY ? "✓ Configured" : "✗ Not configured"}`);
    console.log(`      OpenAI Base URL: ${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}`);
  } else if (process.env.USE_PROVIDER === "OPENROUTER") {
    console.log(`      OpenRouter Model: ${process.env.OPENROUTER_MODEL_NAME || "x-ai/grok-2-1212"}`);
    console.log(`      OpenRouter API: ${process.env.OPENROUTER_API_KEY ? "✓ Configured" : "✗ Not configured"}`);
  } else if (process.env.USE_PROVIDER === "OLLAMA") {
    console.log(`      Ollama Host: ${process.env.OLLAMA_HOST || "http://localhost:11434"}`);
    console.log(`      Ollama Model: ${process.env.OLLAMA_MODEL_NAME || "qwen3:4b"}`);
  }
  console.log("");

  try {
    // 使用命令行方式，但禁用标识符混淆
    const compileArgs = [
      "build",
      "--compile",
      "--minify-whitespace",
      "--minify-syntax",
      "--sourcemap",
      entryPoint,
      "--outfile",
      outFile,
    ];

    // Add target for cross-compilation (uses bun-<os>-<arch> format)
    if (bunTarget) {
      compileArgs.push("--target", bunTarget);
    }

    // 编译时环境变量配置
    const defines = {
      // 构建时设置 NODE_ENV 为 production
      "process.env.NODE_ENV": JSON.stringify("production"),
      // 从环境变量读取配置，优先使用 .env.local 中的值
      "process.env.USE_PROVIDER": JSON.stringify(process.env.USE_PROVIDER || "OLLAMA"),
      "process.env.ANTHROPIC_API_KEY": JSON.stringify(process.env.ANTHROPIC_API_KEY || ""),
      "process.env.ANTHROPIC_MODEL_NAME": JSON.stringify(process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-20250514"),
      "process.env.ANTHROPIC_MODEL_CONTEXT_LENGTH": JSON.stringify(process.env.ANTHROPIC_MODEL_CONTEXT_LENGTH || "200000"),
      "process.env.ANTHROPIC_BASE_URL": JSON.stringify(process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"),
      "process.env.OPENAI_API_KEY": JSON.stringify(process.env.OPENAI_API_KEY || ""),
      "process.env.OPENAI_MODEL_NAME": JSON.stringify(process.env.OPENAI_MODEL_NAME || "gpt-4o"),
      "process.env.OPENAI_MODEL_CONTEXT_LENGTH": JSON.stringify(process.env.OPENAI_MODEL_CONTEXT_LENGTH || "128000"),
      "process.env.OPENAI_BASE_URL": JSON.stringify(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
      "process.env.OPENROUTER_API_KEY": JSON.stringify(process.env.OPENROUTER_API_KEY || ""),
      "process.env.OPENROUTER_MODEL_NAME": JSON.stringify(process.env.OPENROUTER_MODEL_NAME || "x-ai/grok-2-1212"),
      "process.env.OPENROUTER_MODEL_CONTEXT_LENGTH": JSON.stringify(process.env.OPENROUTER_MODEL_CONTEXT_LENGTH || "131072"),
      "process.env.OLLAMA_HOST": JSON.stringify(process.env.OLLAMA_HOST || "http://localhost:11434"),
      "process.env.OLLAMA_MODEL_NAME": JSON.stringify(process.env.OLLAMA_MODEL_NAME || "qwen3:4b"),
      "process.env.OLLAMA_CLOUD_HOST": JSON.stringify(process.env.OLLAMA_CLOUD_HOST || "https://ollama.com"),
      "process.env.OLLAMA_CLOUD_API_KEY": JSON.stringify(process.env.OLLAMA_CLOUD_API_KEY || ""),
    };

    // 将 defines 转换为命令行参数
    const defineArgs: string[] = [];
    for (const [key, value] of Object.entries(defines)) {
      defineArgs.push("--define", `${key}=${value}`);
    }

    // 构建完整的编译命令
    const fullCompileArgs = [...compileArgs, ...defineArgs];

    console.log(`   🔧 Running: bun ${fullCompileArgs.join(" ")}`);
    await $`bun ${fullCompileArgs}`.cwd(ROOT_DIR);

    const { size } = Bun.file(outFile);
    const sizeMB = (size / 1024 / 1024).toFixed(2);
    console.log(`   ✅ ${targetName}: ${sizeMB} MB`);

    // Copy ripgrep binary for the target platform (only for current platform)
    const currentPlatform = `${platform}-${arch}`;
    if (!bunTarget || targetName === currentPlatform) {
      await copyRipgrepBinary(dirname(outFile));
    }

    return outFile;
  } catch (error) {
    console.error(`   ❌ Failed to compile for ${targetName}:`, error);
    return null;
  }
}

async function copyRipgrepBinary(targetDir: string) {
  // Determine the correct binary name based on platform
  const isWindows = platform === "win32";
  const rgBinaryName = isWindows ? "rg.exe" : "rg";
  const rgSrcPath = join(ROOT_DIR, "node_modules/@vscode/ripgrep/bin", rgBinaryName);
  const rgDestDir = join(targetDir, "bin");
  const rgDestPath = join(rgDestDir, rgBinaryName);

  if (existsSync(rgSrcPath)) {
    mkdirSync(rgDestDir, { recursive: true });
    copyFileSync(rgSrcPath, rgDestPath);

    // Only set execute permissions on Unix systems
    if (!isWindows) {
      chmodSync(rgDestPath, 0o755);
    }

    console.log(`   ✅ Copied ripgrep binary to ${rgDestDir} (${rgBinaryName})`);

    // Create wrapper script
    const wrapperScript = isWindows
      ? `@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PATH=%SCRIPT_DIR%bin;%PATH%"
"%SCRIPT_DIR%yterm.exe" %*
`
      : `#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$SCRIPT_DIR/bin:$PATH"
exec "$SCRIPT_DIR/yterm" "$@"
`;

    const wrapperName = isWindows ? "yterm-run.bat" : "yterm-run";
    const wrapperPath = join(targetDir, wrapperName);
    writeFileSync(wrapperPath, wrapperScript);

    // Only set execute permissions on Unix systems
    if (!isWindows) {
      chmodSync(wrapperPath, 0o755);
    }

    console.log(`   ✅ Created wrapper script: ${wrapperName}`);
  } else {
    console.warn(`   ⚠️  ripgrep binary not found locally: ${rgSrcPath}`);
  }
}

async function compile() {
  console.log("");
  console.log("🔧 Compiling to single executable (Bun native)...");

  if (crossCompile) {
    // Cross-compile for all targets
    console.log(`   Building for ${TARGETS.length} platforms...`);
    console.log("");

    for (const target of TARGETS) {
      await compileForTarget(target);
    }

    console.log("");
    console.log("📁 Compiled executables:");
    for (const target of TARGETS) {
      const exeName = target.name.startsWith("windows") ? "yterm.exe" : "yterm";
      console.log(`   ${BIN_DIR}/${target.name}/${exeName}`);
    }
  } else {
    // Compile for current platform only (no target means native)
    const exePath = await compileForTarget();

    if (exePath) {
      console.log("");
      console.log(`🎉 Executable created: ${exePath}`);
      console.log("");
      console.log("📁 Package contents:");
      console.log(`   ${dirname(exePath)}/`);
      console.log(`   ├── yterm${platform === "win32" ? ".exe" : ""}    (main executable)`);
      console.log(`   ├── yterm-run${platform === "win32" ? ".bat" : ""}  (wrapper with PATH setup)`);
      console.log(`   └── bin/`);
      console.log(`       └── rg              (ripgrep binary)`);
    }
  }
}

async function main() {
  const startTime = Date.now();

  try {
    await cleanDirs();

    if (compileExecutable || crossCompile) {
      await compile();
    } else {
      await bundle();
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("");
    console.log(`✨ Build completed in ${elapsed}s`);

    if (!compileExecutable && !crossCompile) {
      console.log("");
      console.log("To compile to executable, run:");
      console.log("  bun run build:compile      # Current platform");
      console.log("  bun run build:cross        # All platforms");
    }

  } catch (error) {
    console.error("❌ Build failed:", error);
    process.exit(1);
  }
}

main();