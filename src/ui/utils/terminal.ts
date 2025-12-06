export function setTerminalTitle(title: string): void {
  if (process.platform === 'win32') {
    process.title = title ? `✳ ${title}` : title;
  } else {
    process.stdout.write(`\x1b]0;${title ? `✳ ${title}` : ''}\x07`);
  }
}

export function clearTerminal(): Promise<void> {
  return new Promise(resolve => {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H', () => {
      resolve();
    });
  });
}

export function getCwd(): string {
  return process.cwd();
}
