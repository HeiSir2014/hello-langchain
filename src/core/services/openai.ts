/**
 * OpenAI Service - Returns user-configured model only
 *
 * OpenAI doesn't require maintaining a hardcoded model list.
 * Users configure their model in settings or environment variables.
 */

import { log } from "../../logger.js";
import { getSettings } from "../settings.js";

// Model configuration interface
export interface ParsedOpenAIModel {
  name: string;
  model: string;
  description: string;
  contextWindow: number;
  supportsTools: boolean;
}

/**
 * Get user-configured OpenAI model
 *
 * Returns only the model configured by the user in settings/env.
 * No need to maintain a hardcoded list of official models.
 */
export async function getAllOpenAIModels(): Promise<ParsedOpenAIModel[]> {
  const { openAI } = getSettings();

  // Check if API Key is configured
  if (!openAI.apiKey) {
    log.debug("No OpenAI API key configured, skipping OpenAI models");
    return [];
  }

  // Return only the user-configured model
  const model: ParsedOpenAIModel = {
    name: openAI.model,
    model: openAI.model,
    description: `OpenAI ${openAI.model}`,
    contextWindow: openAI.contextLength || 128000,
    supportsTools: true,
  };

  log.info("Using user-configured OpenAI model", { model: openAI.model });

  return [model];
}

/**
 * Get OpenAI models (with cache - simplified)
 */
export async function getOpenAIModelsWithCache(): Promise<ParsedOpenAIModel[]> {
  return getAllOpenAIModels();
}

/**
 * Get cached models synchronously
 */
export function getCachedOpenAIModelsSync(): ParsedOpenAIModel[] | null {
  const { openAI } = getSettings();

  if (!openAI.apiKey) {
    return null;
  }

  return [{
    name: openAI.model,
    model: openAI.model,
    description: `OpenAI ${openAI.model}`,
    contextWindow: openAI.contextLength || 128000,
    supportsTools: true,
  }];
}

/**
 * Refresh models in background (no-op for user-configured model)
 */
export function refreshOpenAIModelsInBackground(): void {
  // No need to refresh - model comes from user config
}

/**
 * Clear model cache (no-op for user-configured model)
 */
export function clearOpenAIModelCache(): void {
  // No cache to clear
}
