/**
 * Model command
 *
 * Switch or display current model with interactive selection UI.
 */
import React from 'react';
import type { Command } from './index.js';
import { ModelConfig } from '../components/ModelConfig.js';
import { clearTerminal } from '../utils/terminal.js';
import { setCurrentModel } from '../../core/settings.js';
import { getModelConfig, ProviderType } from '../../core/config.js';

const model: Command = {
  type: 'local-jsx',
  name: 'model',
  description: 'Switch model or show current model',
  isEnabled: true,
  isHidden: false,
  aliases: ['m'],
  async call(onDone, context) {
    const handleSelect = async (modelName: string) => {
      // Get the model config to determine its provider
      const modelConfig = getModelConfig(modelName);
      const provider = modelConfig?.provider || ProviderType.OLLAMA;

      // Save to settings (persists across sessions)
      setCurrentModel(provider as any, modelName);

      // Update the agent model
      context.setAgentModel(modelName);
      context.setCurrentModel(modelName);

      // Clear terminal and reset UI to show new model in Logo
      await clearTerminal();
      context.clearMessages();
      context.setForkNumber(prev => prev + 1);

      // Show confirmation message
      context.addSystemMessage(`Switched to model: ${modelName} (${provider})`);
    };

    return (
      <ModelConfig
        currentModel={context.currentModel}
        onSelect={handleSelect}
        onClose={() => onDone()}
      />
    );
  },
  userFacingName() {
    return 'model';
  },
};

export default model;
