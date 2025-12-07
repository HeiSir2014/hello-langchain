/**
 * Help command
 *
 * Shows help and available commands using progressive disclosure.
 */
import * as React from 'react';
import type { Command } from './index.js';
import { Help } from '../components/Help.js';

const help: Command = {
  type: 'local-jsx',
  name: 'help',
  description: 'Show help and available commands',
  isEnabled: true,
  isHidden: false,
  aliases: ['h'],
  async call(_args, onDone, context) {
    return <Help commands={context.commands} onClose={onDone} />;
  },
  userFacingName() {
    return 'help';
  },
};

export default help;
