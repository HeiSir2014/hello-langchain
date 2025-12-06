/**
 * ModelConfig component
 *
 * Interactive model selector for /model command
 */
import { Box, Text, useInput } from 'ink';
import * as React from 'react';
import { useState, useMemo, useEffect } from 'react';
import { getTheme } from '../utils/theme.js';
import {
  ALL_MODELS,
  OPENROUTER_MODELS,
  OPENAI_MODELS,
  ANTHROPIC_MODELS,
  getUseProvider,
  getDefaultModel,
  ProviderType,
  ModelType,
  type ModelConfig as ModelConfigType,
} from '../../core/config.js';
import { getOllamaModelsWithCache, type ParsedOllamaModel } from '../../core/services/ollama.js';

interface Props {
  currentModel: string;
  onSelect: (modelName: string) => void;
  onClose: () => void;
}

interface ModelGroup {
  name: string;
  provider: ProviderType;
  models: ModelConfigType[];
}

// Convert ParsedOllamaModel to ModelConfigType
function toModelConfig(parsed: ParsedOllamaModel): ModelConfigType {
  return {
    name: parsed.name,
    model: parsed.model,
    type: parsed.isCloud ? ModelType.CLOUD : ModelType.LOCAL,
    description: parsed.description,
    supportsTools: parsed.supportsTools,
    contextWindow: parsed.contextWindow,
    provider: ProviderType.OLLAMA,
  };
}

export function ModelConfig({ currentModel: propCurrentModel, onSelect, onClose }: Props): React.ReactNode {
  const theme = getTheme();
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'groups' | 'models'>('groups');
  const [ollamaModels, setOllamaModels] = useState<{ local: ModelConfigType[]; cloud: ModelConfigType[] }>({ local: [], cloud: [] });
  const [isLoading, setIsLoading] = useState(true);

  // 直接从设置获取当前 provider 和 model，确保显示最新值
  const currentProvider = getUseProvider();
  const currentModel = getDefaultModel() || propCurrentModel;

  // Fetch Ollama models
  useEffect(() => {
    getOllamaModelsWithCache().then(({ local, cloud }) => {
      setOllamaModels({
        local: local.map(toModelConfig),
        cloud: cloud.map(toModelConfig),
      });
      setIsLoading(false);
    }).catch(() => {
      setIsLoading(false);
    });
  }, []);

  // Group models by provider
  const modelGroups: ModelGroup[] = useMemo(() => {
    const groups: ModelGroup[] = [];

    if (ollamaModels.local.length > 0) {
      groups.push({ name: 'Ollama Local', provider: ProviderType.OLLAMA, models: ollamaModels.local });
    }
    if (ollamaModels.cloud.length > 0) {
      groups.push({ name: 'Ollama Cloud', provider: ProviderType.OLLAMA, models: ollamaModels.cloud });
    }
    if (OPENROUTER_MODELS.length > 0) {
      groups.push({ name: 'OpenRouter', provider: ProviderType.OPENROUTER, models: OPENROUTER_MODELS });
    }
    if (OPENAI_MODELS.length > 0) {
      groups.push({ name: 'OpenAI', provider: ProviderType.OPENAI, models: OPENAI_MODELS });
    }
    if (ANTHROPIC_MODELS.length > 0) {
      groups.push({ name: 'Anthropic', provider: ProviderType.ANTHROPIC, models: ANTHROPIC_MODELS });
    }

    return groups;
  }, [ollamaModels]);

  const currentGroup = modelGroups[selectedGroupIndex];
  const currentModels = currentGroup?.models || [];

  // Find current model's group and index
  React.useEffect(() => {
    for (let gi = 0; gi < modelGroups.length; gi++) {
      const group = modelGroups[gi];
      const mi = group.models.findIndex(m => m.name === currentModel || m.model === currentModel);
      if (mi !== -1) {
        setSelectedGroupIndex(gi);
        setSelectedModelIndex(mi);
        break;
      }
    }
  }, [currentModel, modelGroups]);

  useInput((input, key) => {
    if (key.escape) {
      if (viewMode === 'models') {
        setViewMode('groups');
      } else {
        onClose();
      }
      return;
    }

    if (viewMode === 'groups') {
      if (key.upArrow) {
        setSelectedGroupIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedGroupIndex(prev => Math.min(modelGroups.length - 1, prev + 1));
      } else if (key.return || input === ' ') {
        setViewMode('models');
        setSelectedModelIndex(0);
      }
    } else {
      // models view
      if (key.upArrow) {
        setSelectedModelIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedModelIndex(prev => Math.min(currentModels.length - 1, prev + 1));
      } else if (key.return || input === ' ') {
        const selectedModel = currentModels[selectedModelIndex];
        if (selectedModel) {
          onSelect(selectedModel.name);
          onClose();
        }
      } else if (key.leftArrow) {
        setViewMode('groups');
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.secondaryBorder}
      paddingX={1}
      marginTop={1}
    >
      <Box flexDirection="column" minHeight={2} marginBottom={1}>
        <Text bold>Model Configuration</Text>
        <Text dimColor>
          Current: <Text color={theme.success}>{currentModel}</Text>
          {' · '}Provider: <Text color={theme.primary}>{currentProvider}</Text>
          {isLoading && ' · Loading models...'}
        </Text>
      </Box>

      {viewMode === 'groups' ? (
        // Group selection view
        <Box flexDirection="column">
          <Box marginBottom={1}><Text dimColor>Select a provider:</Text></Box>
          {modelGroups.map((group, index) => {
            const isSelected = index === selectedGroupIndex;
            const isCurrentProvider = group.provider === currentProvider;
            return (
              <Box key={group.name}>
                <Text color={isSelected ? theme.primary : undefined}>
                  {isSelected ? '❯ ' : '  '}
                  {group.name}
                  <Text dimColor> ({group.models.length} models)</Text>
                  {isCurrentProvider && <Text color={theme.success}> ★</Text>}
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : (
        // Model selection view
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>← </Text>
            <Text bold>{currentGroup?.name}</Text>
            <Text dimColor> - Select a model:</Text>
          </Box>
          {currentModels.map((model, index) => {
            const isSelected = index === selectedModelIndex;
            const isCurrent = model.name === currentModel || model.model === currentModel;
            return (
              <Box key={model.name} flexDirection="column">
                <Box>
                  <Text color={isSelected ? theme.primary : undefined}>
                    {isSelected ? '❯ ' : '  '}
                    {model.supportsTools ? '🔧 ' : '   '}
                    <Text bold={isCurrent}>{model.name}</Text>
                    {isCurrent && <Text color={theme.success}> (current)</Text>}
                  </Text>
                </Box>
                {isSelected && model.description && (
                  <Box paddingLeft={5}>
                    <Text dimColor>{model.description}</Text>
                    {model.contextWindow && (
                      <Text dimColor> · {Math.round(model.contextWindow / 1000)}K ctx</Text>
                    )}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Box
        marginTop={1}
        paddingTop={1}
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor={theme.secondaryBorder}
      >
        <Text dimColor>
          {viewMode === 'groups'
            ? '↑/↓ navigate · Enter select provider · Esc close'
            : '↑/↓ navigate · Enter select model · ← back · Esc close'}
        </Text>
      </Box>
    </Box>
  );
}
