/**
 * Settings management - persistent configuration storage
 *
 * Settings are stored in ~/.yterm/settings.json and can be overridden by environment variables.
 * Priority: environment variables > settings.json > .env.local > .env > defaults
 *
 * Project-specific configs (permissions) are stored in ~/.yterm/projects/<hash>/config.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { log } from "../logger.js";

// Settings directory and file
const SETTINGS_DIR = join(homedir(), ".yterm");
const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");
const PROJECTS_DIR = join(SETTINGS_DIR, "projects");

/**
 * Provider types
 */
export type ProviderType = "OLLAMA" | "OPENROUTER" | "OPENAI" | "ANTHROPIC";

/**
 * Permission mode
 * - default: Standard permission checking, ask for confirmation
 * - acceptEdits: Auto-approve edit operations, only confirm bash
 * - plan: Research/planning only, read-only tools only
 * - bypassPermissions: All permissions bypassed (dangerous)
 */
export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

/**
 * Permission mode configuration
 */
export interface PermissionModeConfig {
  icon: string;
  label: string;
  hint: string;
  color: string;
  /** Mode only allows read-only tools */
  readOnly?: boolean;
  /** Mode requires confirmation for sensitive tools */
  requireConfirmation?: boolean;
  /** Mode bypasses all permission checks */
  bypassValidation?: boolean;
  /** Tools allowed in this mode (undefined = all, array = specific tools only) */
  allowedTools?: string[];
}

/** Tools allowed in plan mode */
export const PLAN_MODE_TOOLS = [
  // Read-only exploration tools
  "Read",
  "Glob",
  "Grep",
  "LS",
  "WebSearch",
  "WebFetch",
  "Location",
  "BashOutput",
  // Plan management tools (can write plans, not code)
  "SavePlan",
  "ReadPlan",
  "TodoWrite",
  // Exit plan mode
  "ExitPlanMode",
];

/**
 * Permission mode configurations
 */
export const MODE_CONFIGS: Record<PermissionMode, PermissionModeConfig> = {
  default: {
    icon: "⏵",
    label: "ask permissions",
    hint: "shift+tab to cycle",
    color: "gray",
    requireConfirmation: true,
  },
  acceptEdits: {
    icon: "⏵⏵",
    label: "accept edits on",
    hint: "shift+tab to cycle",
    color: "yellow",
    requireConfirmation: false,
  },
  plan: {
    icon: "📝",
    label: "plan mode",
    hint: "read-only tools only",
    color: "blue",
    readOnly: true,
    requireConfirmation: true,
    allowedTools: PLAN_MODE_TOOLS,
  },
  bypassPermissions: {
    icon: "⏵⏵⏵",
    label: "bypass permissions on",
    hint: "shift+tab to cycle",
    color: "red",
    bypassValidation: true,
  },
};

/**
 * Project-specific configuration (stored per project)
 */
export interface ProjectConfig {
  /** List of allowed tool patterns (e.g., "BashTool(npm:*)", "Bash(git diff)") */
  allowedTools: string[];
  /** Whether trust dialog has been accepted */
  hasTrustDialogAccepted?: boolean;
}

/**
 * Settings schema - mirrors all environment variable configurations
 */
export interface Settings {
  // Current selection
  provider: ProviderType;

  // Permission settings
  /** Enable safe mode - require confirmations for sensitive tools (default: true) */
  safeMode: boolean;
  /** Current permission mode */
  permissionMode: PermissionMode;

  // Ollama configuration
  ollama: {
    host: string;
    cloudHost: string;
    cloudApiKey: string;
    model: string;
  };

  // OpenRouter configuration
  openRouter: {
    apiKey: string;
    model: string;
    contextLength: number;
  };

  // OpenAI configuration
  openAI: {
    apiKey: string;
    baseUrl: string;
    model: string;
    contextLength: number;
  };

  // Anthropic configuration
  anthropic: {
    apiKey: string;
    baseUrl: string;
    model: string;
    contextLength: number;
  };
}

/**
 * Default settings
 */
const DEFAULT_SETTINGS: Settings = {
  provider: "OLLAMA",

  // Permission defaults - safe mode enabled by default
  safeMode: true,
  permissionMode: "default",

  ollama: {
    host: "http://localhost:11434",
    cloudHost: "https://ollama.com",
    cloudApiKey: "",
    model: "qwen3:8b",
  },

  openRouter: {
    apiKey: "",
    model: "x-ai/grok-2-1212",
    contextLength: 131072,
  },

  openAI: {
    apiKey: "",
    baseUrl: "",
    model: "gpt-4o",
    contextLength: 128000,
  },

  anthropic: {
    apiKey: "",
    baseUrl: "",
    model: "claude-sonnet-4-20250514",
    contextLength: 200000,
  },
};

// In-memory cache
let cachedSettings: Settings | null = null;

/**
 * Ensure settings directory exists
 */
function ensureSettingsDir(): void {
  if (!existsSync(SETTINGS_DIR)) {
    mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

/**
 * Load settings from file
 */
function loadSettingsFromFile(): Partial<Settings> | null {
  try {
    if (!existsSync(SETTINGS_FILE)) {
      return null;
    }
    const data = readFileSync(SETTINGS_FILE, "utf-8");
    return JSON.parse(data) as Partial<Settings>;
  } catch (error) {
    log.debug("Failed to load settings file", { error });
    return null;
  }
}

/**
 * Merge settings with environment variables
 * Priority: environment variables > settings.json > defaults
 */
function mergeWithEnv(fileSettings: Partial<Settings> | null): Settings {
  const env = process.env;

  // Start with defaults
  const settings: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

  // Apply file settings first (middle priority)
  if (fileSettings) {
    if (fileSettings.provider) settings.provider = fileSettings.provider;
    if (fileSettings.safeMode !== undefined) settings.safeMode = fileSettings.safeMode;
    if (fileSettings.permissionMode) settings.permissionMode = fileSettings.permissionMode;

    if (fileSettings.ollama) {
      Object.assign(settings.ollama, fileSettings.ollama);
    }
    if (fileSettings.openRouter) {
      Object.assign(settings.openRouter, fileSettings.openRouter);
    }
    if (fileSettings.openAI) {
      Object.assign(settings.openAI, fileSettings.openAI);
    }
    if (fileSettings.anthropic) {
      Object.assign(settings.anthropic, fileSettings.anthropic);
    }
  }

  // Apply environment variables (highest priority - override file settings)
  if (env.USE_PROVIDER) {
    settings.provider = env.USE_PROVIDER.toUpperCase() as ProviderType;
  }

  // Ollama
  if (env.OLLAMA_HOST) settings.ollama.host = env.OLLAMA_HOST;
  if (env.OLLAMA_CLOUD_HOST) settings.ollama.cloudHost = env.OLLAMA_CLOUD_HOST;
  if (env.OLLAMA_CLOUD_API_KEY || env.OLLAMA_API_KEY) {
    settings.ollama.cloudApiKey = env.OLLAMA_CLOUD_API_KEY || env.OLLAMA_API_KEY || "";
  }
  if (env.OLLAMA_MODEL_NAME) settings.ollama.model = env.OLLAMA_MODEL_NAME;

  // OpenRouter
  if (env.OPENROUTER_API_KEY) settings.openRouter.apiKey = env.OPENROUTER_API_KEY;
  if (env.OPENROUTER_MODEL_NAME) settings.openRouter.model = env.OPENROUTER_MODEL_NAME;
  if (env.OPENROUTER_MODEL_CONTEXT_LENGTH) {
    settings.openRouter.contextLength = Number(env.OPENROUTER_MODEL_CONTEXT_LENGTH);
  }

  // OpenAI
  if (env.OPENAI_API_KEY) settings.openAI.apiKey = env.OPENAI_API_KEY;
  if (env.OPENAI_BASE_URL) settings.openAI.baseUrl = env.OPENAI_BASE_URL;
  if (env.OPENAI_MODEL_NAME) settings.openAI.model = env.OPENAI_MODEL_NAME;
  if (env.OPENAI_MODEL_CONTEXT_LENGTH) {
    settings.openAI.contextLength = Number(env.OPENAI_MODEL_CONTEXT_LENGTH);
  }

  // Anthropic
  if (env.ANTHROPIC_API_KEY) settings.anthropic.apiKey = env.ANTHROPIC_API_KEY;
  if (env.ANTHROPIC_BASE_URL) settings.anthropic.baseUrl = env.ANTHROPIC_BASE_URL;
  if (env.ANTHROPIC_MODEL_NAME) settings.anthropic.model = env.ANTHROPIC_MODEL_NAME;
  if (env.ANTHROPIC_MODEL_CONTEXT_LENGTH) {
    settings.anthropic.contextLength = Number(env.ANTHROPIC_MODEL_CONTEXT_LENGTH);
  }

  return settings;
}

/**
 * Get current settings (cached)
 */
export function getSettings(): Settings {
  if (cachedSettings) {
    return cachedSettings;
  }

  const fileSettings = loadSettingsFromFile();
  cachedSettings = mergeWithEnv(fileSettings);
  return cachedSettings;
}

/**
 * Save settings to file
 */
export function saveSettings(settings: Partial<Settings>): void {
  ensureSettingsDir();

  // Load existing settings and merge
  const existing = loadSettingsFromFile() || {};
  const merged = { ...existing, ...settings };

  // Deep merge nested objects
  if (settings.ollama) {
    merged.ollama = { ...(existing.ollama || {}), ...settings.ollama };
  }
  if (settings.openRouter) {
    merged.openRouter = { ...(existing.openRouter || {}), ...settings.openRouter };
  }
  if (settings.openAI) {
    merged.openAI = { ...(existing.openAI || {}), ...settings.openAI };
  }
  if (settings.anthropic) {
    merged.anthropic = { ...(existing.anthropic || {}), ...settings.anthropic };
  }

  writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));

  // Update cache
  cachedSettings = mergeWithEnv(merged);

  log.info("Settings saved", { file: SETTINGS_FILE });
}

/**
 * Update current provider and model
 */
export function setCurrentModel(provider: ProviderType, model: string): void {
  // 获取当前设置，只更新模型字段
  const currentSettings = getSettings();
  const settingsUpdate: Partial<Settings> = { provider };
  
  // 根据 provider 设置对应的模型，保持其他字段不变
  switch (provider) {
    case "OLLAMA":
      settingsUpdate.ollama = { ...currentSettings.ollama, model };
      break;
    case "OPENROUTER":
      settingsUpdate.openRouter = { ...currentSettings.openRouter, model };
      break;
    case "OPENAI":
      settingsUpdate.openAI = { ...currentSettings.openAI, model };
      break;
    case "ANTHROPIC":
      settingsUpdate.anthropic = { ...currentSettings.anthropic, model };
      break;
  }
  
  saveSettings(settingsUpdate);
}

/**
 * Get current provider
 */
export function getCurrentProvider(): ProviderType {
  return getSettings().provider;
}

/**
 * Get current model based on current provider
 */
export function getCurrentModel(): string {
  const settings = getSettings();
  
  switch (settings.provider) {
    case "OLLAMA":
      return settings.ollama.model;
    case "OPENROUTER":
      return settings.openRouter.model;
    case "OPENAI":
      return settings.openAI.model;
    case "ANTHROPIC":
      return settings.anthropic.model;
    default:
      return settings.ollama.model;
  }
}

/**
 * Clear settings cache (force reload from file)
 */
export function clearSettingsCache(): void {
  cachedSettings = null;
}

/**
 * Get settings file path
 */
export function getSettingsFilePath(): string {
  return SETTINGS_FILE;
}

// ==========================================
// Project Config Management
// ==========================================

// Cache for project config
let cachedProjectConfig: ProjectConfig | null = null;
let cachedProjectPath: string | null = null;

/**
 * Get project hash for storing project-specific config
 */
function getProjectHash(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 16);
}

/**
 * Get project config directory
 */
function getProjectConfigDir(projectPath: string): string {
  const hash = getProjectHash(projectPath);
  return join(PROJECTS_DIR, hash);
}

/**
 * Get project config file path
 */
function getProjectConfigFile(projectPath: string): string {
  return join(getProjectConfigDir(projectPath), "config.json");
}

/**
 * Default project config
 */
const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  allowedTools: [],
  hasTrustDialogAccepted: false,
};

/**
 * Load project config from file
 */
function loadProjectConfigFromFile(projectPath: string): ProjectConfig {
  try {
    const configFile = getProjectConfigFile(projectPath);
    if (!existsSync(configFile)) {
      return { ...DEFAULT_PROJECT_CONFIG };
    }
    const data = readFileSync(configFile, "utf-8");
    const config = JSON.parse(data) as Partial<ProjectConfig>;
    return {
      ...DEFAULT_PROJECT_CONFIG,
      ...config,
    };
  } catch (error) {
    log.debug("Failed to load project config", { error, projectPath });
    return { ...DEFAULT_PROJECT_CONFIG };
  }
}

/**
 * Get current project config (cached)
 */
export function getProjectConfig(projectPath?: string): ProjectConfig {
  const path = projectPath || process.cwd();

  if (cachedProjectConfig && cachedProjectPath === path) {
    return cachedProjectConfig;
  }

  cachedProjectConfig = loadProjectConfigFromFile(path);
  cachedProjectPath = path;
  return cachedProjectConfig;
}

/**
 * Save project config to file
 */
export function saveProjectConfig(config: Partial<ProjectConfig>, projectPath?: string): void {
  const path = projectPath || process.cwd();
  const configDir = getProjectConfigDir(path);
  const configFile = getProjectConfigFile(path);

  try {
    // Ensure directory exists
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // Load existing and merge
    const existing = loadProjectConfigFromFile(path);
    const merged: ProjectConfig = {
      ...existing,
      ...config,
    };

    writeFileSync(configFile, JSON.stringify(merged, null, 2));

    // Update cache
    cachedProjectConfig = merged;
    cachedProjectPath = path;

    log.debug("Project config saved", { file: configFile });
  } catch (error) {
    log.error("Failed to save project config", { error, projectPath: path });
  }
}

/**
 * Add allowed tool to project config
 */
export function addAllowedTool(toolKey: string, projectPath?: string): void {
  const config = getProjectConfig(projectPath);
  if (!config.allowedTools.includes(toolKey)) {
    config.allowedTools.push(toolKey);
    saveProjectConfig({ allowedTools: config.allowedTools }, projectPath);
  }
}

/**
 * Check if tool is allowed in project config
 */
export function isToolAllowed(toolKey: string, projectPath?: string): boolean {
  const config = getProjectConfig(projectPath);
  return config.allowedTools.includes(toolKey);
}

/**
 * Clear project config cache
 */
export function clearProjectConfigCache(): void {
  cachedProjectConfig = null;
  cachedProjectPath = null;
}

/**
 * Get safe mode setting
 */
export function isSafeModeEnabled(): boolean {
  return getSettings().safeMode;
}

/**
 * Get current permission mode
 */
export function getPermissionMode(): PermissionMode {
  return getSettings().permissionMode;
}

/**
 * Set permission mode
 */
export function setPermissionMode(mode: PermissionMode): void {
  saveSettings({ permissionMode: mode });
}

/**
 * Cycle through permission modes
 * Order: default → acceptEdits → plan → bypassPermissions → default
 */
export function cyclePermissionMode(skipBypass: boolean = false): PermissionMode {
  const currentMode = getPermissionMode();
  let modes: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];

  // Skip bypass mode if in safe mode
  if (skipBypass) {
    modes = modes.filter(m => m !== "bypassPermissions");
  }

  const currentIndex = modes.indexOf(currentMode);
  const nextIndex = (currentIndex + 1) % modes.length;
  const nextMode = modes[nextIndex];
  setPermissionMode(nextMode);
  return nextMode;
}

/**
 * Check if current mode allows a specific tool
 */
export function isToolAllowedInCurrentMode(toolName: string): boolean {
  const mode = getPermissionMode();
  const config = MODE_CONFIGS[mode];

  // If no tool restrictions, all tools allowed
  if (!config.allowedTools) {
    return true;
  }

  return config.allowedTools.includes(toolName);
}

/**
 * Get allowed tools for current mode
 */
export function getAllowedToolsForCurrentMode(): string[] | null {
  const mode = getPermissionMode();
  const config = MODE_CONFIGS[mode];
  return config.allowedTools || null;
}

/**
 * Check if current mode is read-only
 */
export function isReadOnlyMode(): boolean {
  const mode = getPermissionMode();
  return MODE_CONFIGS[mode].readOnly === true;
}
