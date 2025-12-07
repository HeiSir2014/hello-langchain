/**
 * Project Configuration Service
 *
 * Manages project-level configuration and onboarding state.
 * Stores settings in .yterm/project.json within the project directory.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { log } from "../../logger.js";

// ============ Types ============

export interface ProjectConfig {
  /** Whether the project has completed initial onboarding */
  hasCompletedProjectOnboarding: boolean;
  /** When the project was first initialized */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
  /** Custom context to inject into prompts */
  customContext?: string;
  /** Preferred model for this project */
  preferredModel?: string;
  /** Project-specific permission overrides */
  permissions?: {
    allowedCommands?: string[];
    blockedPaths?: string[];
  };
}

// ============ Constants ============

const CONFIG_DIR = ".yterm";
const CONFIG_FILE = "project.json";
const PRODUCT_FILE = "CLAUDE.md"; // The file we generate

// ============ Config Operations ============

/**
 * Get the project config directory path
 */
export function getProjectConfigDir(): string {
  return join(process.cwd(), CONFIG_DIR);
}

/**
 * Get the project config file path
 */
export function getProjectConfigPath(): string {
  return join(getProjectConfigDir(), CONFIG_FILE);
}

/**
 * Get the CLAUDE.md file path
 */
export function getProductFilePath(): string {
  return join(process.cwd(), PRODUCT_FILE);
}

/**
 * Check if CLAUDE.md exists
 */
export function hasProductFile(): boolean {
  return existsSync(getProductFilePath());
}

/**
 * Get the default project configuration
 */
function getDefaultConfig(): ProjectConfig {
  const now = new Date().toISOString();
  return {
    hasCompletedProjectOnboarding: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Load the current project configuration
 */
export function getProjectConfig(): ProjectConfig {
  const configPath = getProjectConfigPath();

  if (!existsSync(configPath)) {
    return getDefaultConfig();
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const config = JSON.parse(content) as ProjectConfig;
    return {
      ...getDefaultConfig(),
      ...config,
    };
  } catch (error: any) {
    log.warn(`Failed to read project config: ${error.message}`);
    return getDefaultConfig();
  }
}

/**
 * Save the project configuration
 */
export function saveProjectConfig(config: ProjectConfig): void {
  const configDir = getProjectConfigDir();
  const configPath = getProjectConfigPath();

  try {
    // Ensure directory exists
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // Update timestamp
    config.updatedAt = new Date().toISOString();

    // Write config
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    log.info("Project config saved", { path: configPath });
  } catch (error: any) {
    log.error(`Failed to save project config: ${error.message}`);
    throw error;
  }
}

/**
 * Update specific fields in the project configuration
 */
export function updateProjectConfig(updates: Partial<ProjectConfig>): ProjectConfig {
  const current = getProjectConfig();
  const updated = { ...current, ...updates };
  saveProjectConfig(updated);
  return updated;
}

// ============ Onboarding State ============

/**
 * Check if project onboarding has been completed
 */
export function hasCompletedOnboarding(): boolean {
  return getProjectConfig().hasCompletedProjectOnboarding;
}

/**
 * Mark project onboarding as complete
 */
export function markOnboardingComplete(): void {
  updateProjectConfig({ hasCompletedProjectOnboarding: true });
  log.info("Project onboarding marked as complete");
}

/**
 * Check if the project needs initialization
 * Returns true if:
 * - No CLAUDE.md exists, OR
 * - Onboarding hasn't been completed
 */
export function needsInitialization(): boolean {
  return !hasProductFile() || !hasCompletedOnboarding();
}

// ============ Custom Context ============

/**
 * Set custom context for the project
 */
export function setCustomContext(context: string): void {
  updateProjectConfig({ customContext: context });
}

/**
 * Get custom context for the project
 */
export function getCustomContext(): string | undefined {
  return getProjectConfig().customContext;
}

// ============ Preferred Model ============

/**
 * Set preferred model for the project
 */
export function setPreferredModel(model: string): void {
  updateProjectConfig({ preferredModel: model });
}

/**
 * Get preferred model for the project
 */
export function getPreferredModel(): string | undefined {
  return getProjectConfig().preferredModel;
}
