/**
 * Output utilities - shared by tools
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Output size threshold (write to temp file if exceeds)
export const OUTPUT_THRESHOLD = 30000;

// Temp file directory
const TEMP_DIR = join(tmpdir(), "yterm-tools");

// Ensure temp directory exists
function ensureTempDir(): void {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }
}

// Generate temp file path
function getTempFilePath(prefix: string): string {
  ensureTempDir();
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return join(TEMP_DIR, `${prefix}_${timestamp}_${random}.txt`);
}

// Output metadata interface
export interface OutputMetadata {
  tempFile: string;
  totalLines: number;
  totalBytes: number;
  preview: string;
}

// Write large output to temp file
export function writeToTempFile(content: string, prefix: string): OutputMetadata {
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

export { TEMP_DIR };
