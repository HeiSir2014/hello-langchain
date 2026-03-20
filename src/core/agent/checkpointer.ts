/**
 * Checkpointer Factory
 *
 * Provides persistent checkpointing via SQLite for durable agent state.
 * Falls back to MemorySaver (in-memory) if SQLite is unavailable.
 *
 * Uses @langchain/langgraph-checkpoint-sqlite for production persistence
 * and MemorySaver from @langchain/langgraph for development/fallback.
 */

import { MemorySaver } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync } from "fs";
import { log } from "../../logger.js";

// Type for any checkpointer that can be passed to graph.compile()
export type Checkpointer = MemorySaver | SqliteSaver;

// Settings directory for persistent storage
const YTERM_DIR = join(homedir(), ".yterm");
const DB_DIR = join(YTERM_DIR, "data");
const DB_PATH = join(DB_DIR, "checkpoints.db");

/**
 * Create a persistent SQLite checkpointer.
 * Falls back to MemorySaver if SQLite initialization fails.
 */
export function createCheckpointer(): Checkpointer {
  try {
    // Ensure data directory exists
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true });
    }

    const saver = SqliteSaver.fromConnString(DB_PATH);
    log.info("SQLite checkpointer initialized", { path: DB_PATH });
    return saver;
  } catch (error: any) {
    log.warn("Failed to initialize SQLite checkpointer, falling back to MemorySaver", {
      error: error.message,
    });
    return new MemorySaver();
  }
}

/**
 * Create an in-memory checkpointer (for testing or ephemeral sessions).
 */
export function createMemoryCheckpointer(): MemorySaver {
  return new MemorySaver();
}

/**
 * Get the database path for the SQLite checkpointer.
 */
export function getCheckpointDbPath(): string {
  return DB_PATH;
}
