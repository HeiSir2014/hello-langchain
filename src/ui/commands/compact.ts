/**
 * Compact command
 *
 * Clears conversation history but keeps a summary in context.
 * Uses LLM to generate a comprehensive 8-section summary.
 */
import type { Command } from './index.js';
import { clearTerminal } from '../utils/terminal.js';
import { compactWithSummary } from '../../core/agent/index.js';

const compact: Command = {
  type: 'local',
  name: 'compact',
  description: 'Clear conversation history but keep a summary in context',
  isEnabled: true,
  isHidden: false,
  async call(_, context) {
    try {
      // Show progress message
      context.addSystemMessage('Generating conversation summary...');

      // Generate summary and compact
      const { summary, messagesBefore } = await compactWithSummary();

      if (messagesBefore === 0) {
        context.addSystemMessage('No conversation history to compact.');
        return '';
      }

      // Clear terminal and UI messages
      await clearTerminal();
      context.clearMessages();
      context.setForkNumber(prev => prev + 1);

      // Show completion message
      if (summary) {
        context.addSystemMessage(
          `Conversation compacted: ${messagesBefore} messages → summary preserved.\n` +
          `Context has been compressed using structured 8-section algorithm.`
        );
      } else {
        context.addSystemMessage('Conversation cleared (no summary generated).');
      }

      return '';
    } catch (error: any) {
      context.addSystemMessage(`Compact failed: ${error.message}`);
      return '';
    }
  },
  userFacingName() {
    return 'compact';
  },
};

export default compact;
