/**
 * Image paste utility
 *
 * Supports pasting images from clipboard on macOS
 */
import { execSync } from 'child_process';
import { readFileSync, existsSync, unlinkSync } from 'fs';

const SCREENSHOT_PATH = '/tmp/yterm_clipboard_image.png';

export const CLIPBOARD_ERROR_MESSAGE =
  'No image found in clipboard. Use Cmd + Ctrl + Shift + 4 to copy a screenshot to clipboard.';

/**
 * Get image from clipboard as base64 string
 * Currently only supports macOS
 *
 * @returns base64 encoded image string, or null if no image in clipboard
 */
export function getImageFromClipboard(): string | null {
  if (process.platform !== 'darwin') {
    // Only support image paste on macOS for now
    return null;
  }

  try {
    // Check if clipboard has image
    execSync(`osascript -e 'the clipboard as «class PNGf»'`, {
      stdio: 'ignore',
    });

    // Save the image from clipboard
    execSync(
      `osascript -e 'set png_data to (the clipboard as «class PNGf»)' -e 'set fp to open for access POSIX file "${SCREENSHOT_PATH}" with write permission' -e 'write png_data to fp' -e 'close access fp'`,
      { stdio: 'ignore' },
    );

    // Read the image and convert to base64
    const imageBuffer = readFileSync(SCREENSHOT_PATH);
    const base64Image = imageBuffer.toString('base64');

    // Cleanup
    try {
      unlinkSync(SCREENSHOT_PATH);
    } catch {
      // Ignore cleanup errors
    }

    return base64Image;
  } catch {
    return null;
  }
}

/**
 * Check if clipboard contains an image
 */
export function hasImageInClipboard(): boolean {
  if (process.platform !== 'darwin') {
    return false;
  }

  try {
    execSync(`osascript -e 'the clipboard as «class PNGf»'`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get image info from base64 string (basic validation)
 */
export function getImageInfo(base64Image: string): {
  sizeKB: number;
  isValid: boolean;
} {
  try {
    const buffer = Buffer.from(base64Image, 'base64');
    const sizeKB = Math.round(buffer.length / 1024);

    // Check for PNG magic bytes
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    // Check for JPEG magic bytes
    const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;

    return {
      sizeKB,
      isValid: isPng || isJpeg,
    };
  } catch {
    return {
      sizeKB: 0,
      isValid: false,
    };
  }
}
