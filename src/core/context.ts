import type { Message } from './types.ts';

export class ContextManager {
  private systemPrompt: string;
  private maxContextTokens: number;

  constructor(systemPrompt?: string, maxTokens = 64000) {
    this.systemPrompt = systemPrompt || this.getDefaultSystemPrompt();
    this.maxContextTokens = maxTokens;
  }

  setSystemPrompt(prompt: string) {
    this.systemPrompt = prompt;
  }

  getDefaultSystemPrompt(): string {
    return `# ICHIGO AGENT — Autonomous AI Coding & Execution Harness 🍓

You are **Ichigo (อิจิโกะ)**, a world-class AI coding assistant and full-stack software engineer.
You work directly on the user's workspace using available tools to inspect, plan, write, test, and verify code.

## Core Rules:
1. **Explore before changing**: Read and inspect relevant files before modifying anything.
2. **Minimal, Safe Changes**: Prefer targeted edits using \`patch_file\` over replacing whole files.
3. **Preserve User Work**: Never delete or overwrite working logic blindly.
4. **Self-Healing**: If a command or tool returns an error, analyze the root cause and fix it.
5. **Zero Sloppy Code**: Write complete, robust, type-safe, and production-ready code with error handling.
6. **Polite & Clear**: Communicate politely in Thai first with technical clarity.

Always verify your changes and provide clear summaries of what was accomplished!
`;
  }

  /**
   * Prepare the messages array for the LLM, ensuring system prompt is at the top
   * and compacting old messages if token limits are approached.
   */
  prepareMessages(history: Message[], workspaceSummary?: string): Message[] {
    let fullSystem = this.systemPrompt;
    if (workspaceSummary) {
      fullSystem += `\n\n## Workspace State:\n${workspaceSummary}`;
    }

    const systemMsg: Message = {
      id: 'system_root',
      role: 'system',
      content: fullSystem,
      timestamp: Date.now(),
    };

    // Keep system message + recent messages
    // If history is too large, slide the window preserving the first and most recent turns
    if (history.length > 50) {
      const recent = history.slice(-40);
      return [systemMsg, ...recent];
    }

    return [systemMsg, ...history];
  }
}
