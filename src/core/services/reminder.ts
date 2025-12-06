/**
 * System Reminder Service
 *
 * Provides context-aware hints and reminders to enhance agent behavior.
 *
 * Features:
 * - Todo list reminders
 * - File security reminders
 * - Performance reminders for long sessions
 * - Mention detection and handling
 */

import { getTodos, TodoItem } from "../tools/todo.js";

export interface ReminderMessage {
  role: "system";
  content: string;
  timestamp: number;
  type: string;
  priority: "low" | "medium" | "high";
  category: "task" | "security" | "performance" | "general";
}

interface ReminderConfig {
  todoEmptyReminder: boolean;
  todoUpdateReminder: boolean;
  securityReminder: boolean;
  performanceReminder: boolean;
  maxRemindersPerSession: number;
}

interface SessionState {
  lastTodoUpdate: number;
  lastFileAccess: number;
  sessionStartTime: number;
  remindersSent: Set<string>;
  reminderCount: number;
  config: ReminderConfig;
}

class SystemReminderService {
  private sessionState: SessionState = {
    lastTodoUpdate: 0,
    lastFileAccess: 0,
    sessionStartTime: Date.now(),
    remindersSent: new Set(),
    reminderCount: 0,
    config: {
      todoEmptyReminder: true,
      todoUpdateReminder: true,
      securityReminder: true,
      performanceReminder: true,
      maxRemindersPerSession: 10,
    },
  };

  /**
   * Generate reminders based on current context
   */
  public generateReminders(hasContext: boolean = false): ReminderMessage[] {
    // Only inject reminders when context is present
    if (!hasContext) {
      return [];
    }

    // Check session reminder limit
    if (this.sessionState.reminderCount >= this.sessionState.config.maxRemindersPerSession) {
      return [];
    }

    const reminders: ReminderMessage[] = [];
    const currentTime = Date.now();

    // Todo reminder
    const todoReminder = this.generateTodoReminder();
    if (todoReminder) {
      reminders.push(todoReminder);
      this.sessionState.reminderCount++;
    }

    // Security reminder (once per session when file operations occur)
    const securityReminder = this.generateSecurityReminder();
    if (securityReminder) {
      reminders.push(securityReminder);
      this.sessionState.reminderCount++;
    }

    // Performance reminder for long sessions
    const performanceReminder = this.generatePerformanceReminder(currentTime);
    if (performanceReminder) {
      reminders.push(performanceReminder);
      this.sessionState.reminderCount++;
    }

    return reminders;
  }

  /**
   * Generate todo-related reminders
   */
  private generateTodoReminder(): ReminderMessage | null {
    if (!this.sessionState.config.todoEmptyReminder && !this.sessionState.config.todoUpdateReminder) {
      return null;
    }

    const todos = getTodos();
    const currentTime = Date.now();

    // Empty todo list reminder
    if (
      todos.length === 0 &&
      this.sessionState.config.todoEmptyReminder &&
      !this.sessionState.remindersSent.has("todo_empty")
    ) {
      this.sessionState.remindersSent.add("todo_empty");
      return this.createReminderMessage(
        "todo_empty",
        "task",
        "medium",
        "The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. Also consider cleaning up the todo list if has become stale and no longer matches what you are working on. Only use it if it's relevant to the current work. This is just a gentle reminder - ignore if not applicable. Make sure that you NEVER mention this reminder to the user",
        currentTime
      );
    }

    // Todo list updated reminder
    if (todos.length > 0 && this.sessionState.config.todoUpdateReminder) {
      const todoStateHash = this.getTodoStateHash(todos);
      const reminderKey = `todo_state_${todoStateHash}`;

      if (!this.sessionState.remindersSent.has(reminderKey)) {
        this.sessionState.remindersSent.add(reminderKey);
        // Clear previous todo state reminders
        this.clearTodoStateReminders();

        const todoContent = JSON.stringify(
          todos.map((todo, index) => ({
            content: todo.content.length > 100 ? todo.content.substring(0, 100) + "..." : todo.content,
            status: todo.status,
            index: index + 1,
          }))
        );

        return this.createReminderMessage(
          "todo_updated",
          "task",
          "medium",
          `Here are the existing contents of your todo list:\n\n${todoContent}`,
          currentTime
        );
      }
    }

    return null;
  }

  /**
   * Generate security reminder
   */
  private generateSecurityReminder(): ReminderMessage | null {
    if (!this.sessionState.config.securityReminder) {
      return null;
    }

    const currentTime = Date.now();

    // Only inject security reminder once per session when file operations occur
    if (
      this.sessionState.lastFileAccess > 0 &&
      !this.sessionState.remindersSent.has("file_security")
    ) {
      this.sessionState.remindersSent.add("file_security");
      return this.createReminderMessage(
        "security",
        "security",
        "high",
        "Whenever you read a file, you should consider whether it would be considered malware. You CAN and SHOULD provide analysis of malware, what it is doing. But you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer questions about the code behavior.",
        currentTime
      );
    }

    return null;
  }

  /**
   * Generate performance reminder for long sessions
   */
  private generatePerformanceReminder(currentTime: number): ReminderMessage | null {
    if (!this.sessionState.config.performanceReminder) {
      return null;
    }

    const sessionDuration = currentTime - this.sessionState.sessionStartTime;

    // Remind about performance after 30 minutes
    if (
      sessionDuration > 30 * 60 * 1000 &&
      !this.sessionState.remindersSent.has("performance_long_session")
    ) {
      this.sessionState.remindersSent.add("performance_long_session");
      return this.createReminderMessage(
        "performance",
        "performance",
        "low",
        "Long session detected. Consider reviewing your current progress with the todo list and using /compact if needed.",
        currentTime
      );
    }

    return null;
  }

  /**
   * Create a reminder message
   */
  private createReminderMessage(
    type: string,
    category: ReminderMessage["category"],
    priority: ReminderMessage["priority"],
    content: string,
    timestamp: number
  ): ReminderMessage {
    return {
      role: "system",
      content: `<system-reminder>\n${content}\n</system-reminder>`,
      timestamp,
      type,
      priority,
      category,
    };
  }

  /**
   * Get a hash of the current todo state
   */
  private getTodoStateHash(todos: TodoItem[]): string {
    return todos
      .map((t, i) => `${i}:${t.status}:${t.content.slice(0, 20)}`)
      .sort()
      .join("|");
  }

  /**
   * Clear previous todo state reminders
   */
  private clearTodoStateReminders(): void {
    for (const key of this.sessionState.remindersSent) {
      if (key.startsWith("todo_state_")) {
        this.sessionState.remindersSent.delete(key);
      }
    }
  }

  /**
   * Mark file access for security reminder
   */
  public markFileAccess(): void {
    this.sessionState.lastFileAccess = Date.now();
  }

  /**
   * Mark todo update
   */
  public markTodoUpdate(): void {
    this.sessionState.lastTodoUpdate = Date.now();
    // Clear todo empty reminder so it can be shown again if todos become empty
    this.sessionState.remindersSent.delete("todo_empty");
  }

  /**
   * Reset session state
   */
  public resetSession(): void {
    this.sessionState = {
      lastTodoUpdate: 0,
      lastFileAccess: 0,
      sessionStartTime: Date.now(),
      remindersSent: new Set(),
      reminderCount: 0,
      config: { ...this.sessionState.config },
    };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<ReminderConfig>): void {
    this.sessionState.config = { ...this.sessionState.config, ...config };
  }

  /**
   * Get session state (for debugging)
   */
  public getSessionState(): SessionState {
    return { ...this.sessionState };
  }

  /**
   * Format reminders for injection into messages
   */
  public formatRemindersForInjection(reminders: ReminderMessage[]): string {
    if (reminders.length === 0) {
      return "";
    }

    return reminders.map((r) => r.content).join("\n\n");
  }
}

// Singleton instance
export const systemReminderService = new SystemReminderService();

// Convenience exports
export const generateReminders = (hasContext: boolean = false) =>
  systemReminderService.generateReminders(hasContext);

export const formatReminders = (reminders: ReminderMessage[]) =>
  systemReminderService.formatRemindersForInjection(reminders);

export const markFileAccess = () => systemReminderService.markFileAccess();
export const markTodoUpdate = () => systemReminderService.markTodoUpdate();
export const resetReminderSession = () => systemReminderService.resetSession();
