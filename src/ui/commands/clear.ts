/**
 * Clear command
 *
 * Clears conversation history and frees up context.
 */
import type { Command } from './index.js';
import { clearTerminal } from '../utils/terminal.js';

const clear: Command = {
  type: 'local',
  name: 'clear',
  description: 'Clear conversation history and free up context',
  isEnabled: true,
  isHidden: false,
  aliases: ['c'],
  async call(_, context) {
    await clearTerminal();
    context.clearMessages();
    context.clearHistory();
    context.setForkNumber(prev => prev + 1);
    return '';
  },
  userFacingName() {
    return 'clear';
  },
};

export default clear;
