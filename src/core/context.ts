import type { Message } from './types.ts';

export interface ActiveSkill {
  name: string;
  content?: string;
}

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
    return `# PROJECT ALISA STUDIO — Autonomous AI Coding & Execution Harness

You are **Alisa (อลิสา)**, a world-class AI coding assistant and full-stack software engineer.
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
  prepareMessages(history: Message[], workspaceSummary?: string, activeSkills: ActiveSkill[] = []): Message[] {
    let fullSystem = this.systemPrompt;
    if (workspaceSummary) {
      fullSystem += `\n\n## Workspace State:\n${workspaceSummary}`;
    }
    if (activeSkills.length > 0) {
      const skillText = activeSkills
        .filter((skill) => skill.name.trim())
        .map((skill) => {
          const content = skill.content?.trim();
          return content
            ? `### ${skill.name}\n${content.slice(0, 8000)}`
            : `### ${skill.name}\nUse this selected skill's focus while completing the task.`;
        })
        .join('\n\n');
      if (skillText) {
        fullSystem += `\n\n## Active Skills\nApply these selected skill instructions for this task:\n${skillText}`;
      }
    }

    const systemMsg: Message = {
      id: 'system_root',
      role: 'system',
      content: fullSystem,
      timestamp: Date.now(),
    };

    const repaired: Message[] = [];
    for (let i = 0; i < history.length; i++) {
      const message = history[i];
      if (message.role === 'tool') continue;
      repaired.push(message);
      if (!message.tool_calls?.length) continue;
      const results: Message[] = [];
      while (history[i + 1]?.role === 'tool') results.push(history[++i]);
      for (const call of message.tool_calls) {
        repaired.push(results.find(result => result.tool_call_id === call.id) || {
          id: `interrupted_${call.id}`, role: 'tool', tool_call_id: call.id,
          content: 'This tool was interrupted. Inspect the workspace before retrying; its side effects are unknown.', timestamp: Date.now(),
        });
      }
    }
    return [systemMsg, ...repaired];
  }
}
