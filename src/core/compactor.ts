import type { Message } from './types.ts';

export interface CompactorOptions {
  maxCharBudget?: number;
  preserveFirstN?: number;
  preserveLastN?: number;
}

export class ContextCompactor {
  private maxCharBudget: number;
  private preserveFirstN: number;
  private preserveLastN: number;

  constructor(options?: CompactorOptions) {
    this.maxCharBudget = options?.maxCharBudget || 90000;
    this.preserveFirstN = options?.preserveFirstN || 2;
    this.preserveLastN = options?.preserveLastN || 8;
  }

  /**
   * Compact message history if total character length exceeds budget
   */
  compactMessages(messages: Message[]): { compacted: Message[]; wasCompacted: boolean; charsSaved: number } {
    let totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    if (totalChars <= this.maxCharBudget || messages.length <= (this.preserveFirstN + this.preserveLastN)) {
      return { compacted: messages, wasCompacted: false, charsSaved: 0 };
    }

    const head = messages.slice(0, this.preserveFirstN);
    const tail = messages.slice(-this.preserveLastN);
    const middle = messages.slice(this.preserveFirstN, -this.preserveLastN);

    // Summarize middle tool calls and lengthy outputs
    let summaryContent = `[ระบบบีบอัด Context อัตโนมัติ: ย่อข้อมูลประวัติการรันเครื่องมือ ${middle.length} รายการ เพื่อรักษา Token Budget]`;

    const summaryMessage: Message = {
      id: `msg_summary_${Date.now()}`,
      role: 'assistant',
      content: summaryContent,
      timestamp: Date.now(),
    };

    const compacted = [...head, summaryMessage, ...tail];
    const newChars = compacted.reduce((sum, m) => sum + (m.content?.length || 0), 0);

    return {
      compacted,
      wasCompacted: true,
      charsSaved: totalChars - newChars,
    };
  }
}
