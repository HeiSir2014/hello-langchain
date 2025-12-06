/**
 * Anthropic Service - Returns user-configured model only
 *
 * Anthropic doesn't require maintaining a hardcoded model list.
 * Users configure their model in settings or environment variables.
 */

import { log } from "../../logger.js";
import { getSettings } from "../settings.js";

// Model configuration interface
export interface ParsedAnthropicModel {
  name: string;
  model: string;
  description: string;
  contextWindow: number;
  supportsTools: boolean;
}

/**
 * Get user-configured Anthropic model
 *
 * Returns only the model configured by the user in settings/env.
 * No need to maintain a hardcoded list of official models.
 */
export async function getAllAnthropicModels(): Promise<ParsedAnthropicModel[]> {
  const { anthropic } = getSettings();

  // Check if API Key is configured
  if (!anthropic.apiKey) {
    log.debug("No Anthropic API key configured, skipping Anthropic models");
    return [];
  }

  // Return only the user-configured model
  const model: ParsedAnthropicModel = {
    name: anthropic.model,
    model: anthropic.model,
    description: `Anthropic ${anthropic.model}`,
    contextWindow: anthropic.contextLength || 200000,
    supportsTools: true,
  };

  log.info("Using user-configured Anthropic model", { model: anthropic.model });

  return [model];
}

/**
 * Get Anthropic models (with cache - simplified)
 */
export async function getAnthropicModelsWithCache(): Promise<ParsedAnthropicModel[]> {
  return getAllAnthropicModels();
}

/**
 * Get cached models synchronously
 */
export function getCachedAnthropicModelsSync(): ParsedAnthropicModel[] | null {
  const { anthropic } = getSettings();

  if (!anthropic.apiKey) {
    return null;
  }

  return [{
    name: anthropic.model,
    model: anthropic.model,
    description: `Anthropic ${anthropic.model}`,
    contextWindow: anthropic.contextLength || 200000,
    supportsTools: true,
  }];
}

/**
 * Refresh models in background (no-op for user-configured model)
 */
export function refreshAnthropicModelsInBackground(): void {
  // No need to refresh - model comes from user config
}

/**
 * Clear model cache (no-op for user-configured model)
 */
export function clearAnthropicModelCache(): void {
  // No cache to clear
}
