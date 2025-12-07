/**
 * Init command
 *
 * Uses a specialized LangGraph sub-agent to analyze the codebase
 * and generate or improve CLAUDE.md file with project documentation.
 *
 * Architecture:
 * - Uses AgentCommand type for running specialized agents
 * - Leverages the InitAgent subgraph (src/core/agent/initAgent.ts)
 * - Follows LangGraph best practices with StateGraph and conditional edges
 */
import type { Command } from './index.js';

const init: Command = {
  type: 'agent',
  name: 'init',
  description: 'Analyze codebase and generate CLAUDE.md file with project documentation',
  isEnabled: true,
  isHidden: false,
  aliases: ['i'],
  progressMessage: 'analyzing your codebase',

  async runAgent(args, context) {
    try {
      // Dynamic import to avoid circular dependencies
      const { runInitAgent } = await import('../../core/agent/initAgent.js');

      // Run the specialized init agent
      const result = await runInitAgent(args || undefined);

      if (result.success) {
        const action = result.isUpdate ? 'updated' : 'created';
        context.addSystemMessage(`CLAUDE.md has been ${action} successfully.`);
      } else {
        context.addSystemMessage(`Failed to initialize: ${result.message}`);
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
    return 'init';
  },
};

export default init;
