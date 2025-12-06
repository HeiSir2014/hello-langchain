#!/usr/bin/env node
// Force color support for chalk - must be set before importing chalk
process.env.FORCE_COLOR = '3';

import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './ui/app.js';
import { getDefaultModel, initializeModels, initializeModelsSync, listModels } from './core/config.js';
import { clearTerminal } from './ui/utils/terminal.js';

const program = new Command()
  .name('YTerm')
  .description('AI Terminal Assistant powered by LangGraph')
  .option('-m, --model <name>', 'Set model')
  .option('-l, --list', 'List available models')
  .option('-p, --prompt <text>', 'Single prompt (non-interactive)')
  .argument('[prompt...]', 'Optional prompt to send')
  .parse(process.argv);

const options = program.opts();
const args = program.args;

// Combine positional args as prompt if no --prompt option provided
const initialPrompt = options.prompt || (args.length > 0 ? args.join(' ') : undefined);

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

  // Get default model from settings (if not specified via CLI)
  const modelToUse = options.model || getDefaultModel();

  // Clear terminal and render the UI
  await clearTerminal();
  render(<App initialModel={modelToUse} initialPrompt={initialPrompt} />, {
    exitOnCtrlC: false, // We handle Ctrl+C ourselves
  });
}

main();
