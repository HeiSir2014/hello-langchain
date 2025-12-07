/**
 * Resume command
 *
 * Resume a previous conversation session with interactive selection.
 * - /resume - Show session selection UI
 * - /resume latest - Resume the most recent session
 */
import * as React from "react";
import type { Command } from "./index.js";
import {
  listSessions,
  loadSession,
  deleteSession,
  getLatestSession,
  restoreSession,
} from "../../core/session/index.js";
import { SessionSelect } from "../components/SessionSelect.js";

const resume: Command = {
  type: "local-jsx",
  name: "resume",
  description: "Resume a previous conversation",
  isEnabled: true,
  isHidden: false,
  aliases: ["r"],

  async call(args, onDone, context) {
    const trimmedArgs = args.trim().toLowerCase();

    // Handle "resume latest" command
    if (trimmedArgs === "latest" || trimmedArgs === "last") {
      const latest = getLatestSession();
      if (!latest) {
        onDone("No saved sessions found.");
        return null;
      }

      const sessionData = loadSession(latest.sessionId);
      if (!sessionData) {
        onDone("Failed to load session.");
        return null;
      }

      // Restore session via context callback
      const restored = restoreSession(sessionData);
      if (context.resumeSession) {
        context.resumeSession({
          sessionId: restored.metadata.sessionId,
          threadId: restored.metadata.threadId,
          model: restored.metadata.model,
          uiMessages: restored.uiMessages,
          langGraphMessages: restored.langGraphMessages,
        });
        onDone(`Resuming session from ${new Date(restored.metadata.updatedAt).toLocaleString()}...`);
      } else {
        onDone("Resume not supported in current context.");
      }
      return null;
    }

    // Load sessions list
    const sessions = listSessions();

    if (sessions.length === 0) {
      onDone("No saved sessions found. Start a conversation first!");
      return null;
    }

    const handleSelect = (sessionId: string) => {
      const sessionData = loadSession(sessionId);
      if (!sessionData) {
        onDone("Failed to load session.");
        return;
      }

      // Restore session via context callback
      const restored = restoreSession(sessionData);
      if (context.resumeSession) {
        context.resumeSession({
          sessionId: restored.metadata.sessionId,
          threadId: restored.metadata.threadId,
          model: restored.metadata.model,
          uiMessages: restored.uiMessages,
          langGraphMessages: restored.langGraphMessages,
        });
        onDone(`Resuming session from ${new Date(restored.metadata.updatedAt).toLocaleString()}...`);
      } else {
        onDone("Resume not supported in current context.");
      }
    };

    const handleDelete = (sessionId: string) => {
      deleteSession(sessionId);
      // Sessions list will be refreshed when component re-renders
    };

    const handleClose = () => {
      onDone();
    };

    // Return interactive selection UI
    return (
      <SessionSelect
        sessions={sessions}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onClose={handleClose}
      />
    );
  },

  userFacingName() {
    return "resume";
  },
};

export default resume;
