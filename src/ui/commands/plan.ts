/**
 * Plan command
 *
 * Enters plan mode for research and planning.
 * In plan mode, only read-only tools are available.
 */
import type { Command } from './index.js';

const plan: Command = {
  type: 'local',
  name: 'plan',
  description: 'Enter plan mode (read-only tools for research and planning)',
  isEnabled: true,
  isHidden: false,
  aliases: ['p'],

  async call(args, context) {
    // Import settings to change mode
    const { setPermissionMode, getPermissionMode, MODE_CONFIGS } = await import('../../core/settings.js');
    const { setPreviousModeBeforePlan } = await import('../../core/tools/plan.js');

    const currentMode = getPermissionMode();

    if (currentMode === 'plan') {
      context.addSystemMessage('Already in plan mode. Use /exit-plan or ExitPlanMode tool to exit.');
      return 'Already in plan mode';
    }

    // Save current mode for restoration
    setPreviousModeBeforePlan(currentMode);

    // Enter plan mode
    setPermissionMode('plan');

    const message = `Entered plan mode. Only read-only tools are available.

Available tools: Read, Glob, Grep, LS, WebSearch, WebFetch
Use ExitPlanMode tool or /exit-plan to return to normal mode.

Tips:
- Research the codebase to understand existing patterns
- Create a detailed implementation plan
- Use SavePlan to save your plan for later reference`;

    context.addSystemMessage(message);

    return message;
  },

  userFacingName() {
    return 'plan';
  },
};

export default plan;
