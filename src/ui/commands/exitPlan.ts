/**
 * Exit Plan command
 *
 * Exits plan mode and returns to normal mode.
 */
import type { Command } from './index.js';

const exitPlan: Command = {
  type: 'local',
  name: 'exit-plan',
  description: 'Exit plan mode and return to normal mode',
  isEnabled: true,
  isHidden: false,
  aliases: ['ep'],

  async call(_args, context) {
    const { setPermissionMode, getPermissionMode } = await import('../../core/settings.js');
    const { getPreviousModeBeforePlan, setPreviousModeBeforePlan } = await import('../../core/tools/plan.js');

    const currentMode = getPermissionMode();

    if (currentMode !== 'plan') {
      context.addSystemMessage('Not in plan mode. Nothing to exit.');
      return 'Not in plan mode';
    }

    // Restore previous mode
    const previousMode = getPreviousModeBeforePlan() || 'default';
    setPermissionMode(previousMode as any);
    setPreviousModeBeforePlan('');

    const message = `Exited plan mode. Restored to "${previousMode}" mode. Full tool access restored.`;
    context.addSystemMessage(message);

    return message;
  },

  userFacingName() {
    return 'exit-plan';
  },
};

export default exitPlan;
