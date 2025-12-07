#!/usr/bin/env node
// Force color support for chalk - must be set before importing chalk
process.env.FORCE_COLOR = '3';

import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './ui/app.js';
import { getDefaultModel, initializeModels, initializeModelsSync, listModels } from './core/config.js';
import { clearTerminal } from './ui/utils/terminal.js';
import { PersistentShell } from './core/utils/PersistentShell.js';
import { getLatestSession, loadSession, restoreSession } from './core/session/index.js';
import { setResumeData } from './ui/commands/resumeState.js';

const program = new Command()
  .name('YTerm')
  .description('AI Terminal Assistant powered by LangGraph')
  .option('-m, --model <name>', 'Set model')
  .option('-l, --list', 'List available models')
  .option('-p, --prompt <text>', 'Single prompt (non-interactive)')
  .option('-c, --continue', 'Continue from the most recent session')
  .option('--resume <sessionId>', 'Resume a specific session by ID')
  .argument('[prompt...]', 'Optional prompt to send')
  .parse(process.argv);

const options = program.opts();
const args = program.args;

// Combine positional args as prompt if no --prompt option provided
const initialPrompt = options.prompt || (args.length > 0 ? args.join(' ') : undefined);

// Cleanup function for graceful exit
function cleanup() {
  try {
    // Close PersistentShell to avoid hanging on exit
    PersistentShell.restart(); // This closes and cleans up the shell
  } catch {
    // Ignore cleanup errors
  }
}

// Register cleanup handlers
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

// Main entry point
async function main() {
  // Handle --list flag (needs full model list)
  if (options.list) {
    await initializeModels(); // Wait for full model list
    listModels();
    process.exit(0);
  }

  // Fast startup: use cached models, refresh in background
  initializeModelsSync();

  // Handle --continue flag (resume most recent session)
  if (options.continue) {
    const latest = getLatestSession();
    if (latest) {
      const sessionData = loadSession(latest.sessionId);
      if (sessionData) {
        const restored = restoreSession(sessionData);
        setResumeData({
          sessionId: restored.metadata.sessionId,
          threadId: restored.metadata.threadId,
          model: restored.metadata.model,
          uiMessages: restored.uiMessages,
          langGraphMessages: restored.langGraphMessages,
        });
        console.log(`Resuming session from ${new Date(restored.metadata.updatedAt).toLocaleString()}...`);
      } else {
        console.error('Failed to load session');
        process.exit(1);
      }
    } else {
      console.error('No saved sessions found');
      process.exit(1);
    }
  }

  // Handle --resume <sessionId> flag
  if (options.resume) {
    const sessionData = loadSession(options.resume);
    if (sessionData) {
      const restored = restoreSession(sessionData);
      setResumeData({
        sessionId: restored.metadata.sessionId,
        threadId: restored.metadata.threadId,
        model: restored.metadata.model,
        uiMessages: restored.uiMessages,
        langGraphMessages: restored.langGraphMessages,
      });
      console.log(`Resuming session ${options.resume}...`);
    } else {
      console.error(`Session not found: ${options.resume}`);
      process.exit(1);
    }
  }

  // Get default model from settings (if not specified via CLI)
  const modelToUse = options.model || getDefaultModel();

  // Clear terminal and render the UI
  await clearTerminal();
  const { waitUntilExit } = render(<App initialModel={modelToUse} initialPrompt={initialPrompt} />, {
    exitOnCtrlC: false, // We handle Ctrl+C ourselves
  });

  // Wait for the app to exit, then cleanup
  await waitUntilExit();
  cleanup();
}

main();
