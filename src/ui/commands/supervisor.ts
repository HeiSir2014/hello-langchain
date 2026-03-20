/**
 * Supervisor command
 *
 * Uses the multi-agent supervisor to coordinate researcher and coder agents
 * for complex tasks that benefit from structured research-then-implement workflows.
 */
import type { Command } from './index.js';

const supervisor: Command = {
  type: 'agent',
  name: 'supervisor',
  description: 'Run multi-agent supervisor for complex tasks (researcher + coder agents)',
  isEnabled: true,
  isHidden: false,
  aliases: ['sup', 'multi'],
  progressMessage: 'coordinating agents',

  async runAgent(args, context) {
    try {
      const { runSupervisor } = await import('../../core/agent/supervisor.js');

      if (!args || args.trim() === '') {
        return {
          success: false,
          message: 'Please provide a task description. Usage: /supervisor <task>',
        };
      }

      const result = await runSupervisor(args);

      if (result.success) {
        context.addSystemMessage('Multi-agent task completed.');
      } else {
        context.addSystemMessage(`Supervisor failed: ${result.message}`);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        success: false,
        message: errorMessage,
      };
    }
  },

  userFacingName() {
    return 'supervisor';
  },
};

export default supervisor;
