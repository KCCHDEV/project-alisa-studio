import type { Goal, Message } from './types.ts';
import { LLMClient, type LLMConfig } from '../llm/client.ts';

export interface SupervisorAssessment {
  isCompleted: boolean;
  needsContinuation: boolean;
  reason: string;
  nextDirective?: string;
  pendingMilestones?: string[];
  driftDetected?: boolean;
}

export interface DriftDetectionResult {
  hasDrift: boolean;
  reason?: string;
  directive?: string;
}

export interface TaskSupervisorOptions {
  llmConfig?: LLMConfig;
  maxContinuationRounds?: number;
}

export class TaskSupervisor {
  private llmConfig?: LLMConfig;
  private maxContinuationRounds: number;
  private recentToolCalls: Array<{ toolName: string; argsString: string }> = [];

  constructor(options: TaskSupervisorOptions = {}) {
    this.llmConfig = options.llmConfig;
    this.maxContinuationRounds = options.maxContinuationRounds ?? 5;
  }

  reset() {
    this.recentToolCalls = [];
  }

  /**
   * Real-time drift detection ("งานเริ่มออกนอกลู่นอกทาง โทรสั่งงาน")
   * Monitors tool calls during agent execution.
   * If the agent is stuck in an exploratory read loop, repeats commands, or diverges,
   * the Supervisor intercepts with a steering directive.
   */
  recordToolCallAndCheckDrift(toolName: string, args: Record<string, any>, userPrompt: string): DriftDetectionResult {
    const argsString = JSON.stringify(args || {});
    this.recentToolCalls.push({ toolName, argsString });

    // Keep sliding window of last 10 tool calls
    if (this.recentToolCalls.length > 10) {
      this.recentToolCalls.shift();
    }

    const window = this.recentToolCalls.slice(-6);

    // Pattern 1: Identical tool call repeated back-to-back with identical arguments
    if (window.length >= 2) {
      const last = window[window.length - 1];
      const prev = window[window.length - 2];
      if (last.toolName === prev.toolName && last.argsString === prev.argsString && last.argsString !== '{}') {
        const shortArgs = last.argsString.slice(0, 60);
        return {
          hasDrift: true,
          reason: `Duplicate tool call: ${last.toolName}`,
          directive: `📞 [Supervisor Alert - โทรสั่งงาน]: คุณกำลังเรียกใช้เครื่องมือ ${last.toolName}(${shortArgs}) ซ้ำซ้อนด้วยคำสั่งเดิม กรุณานำข้อมูลที่ได้มาเริ่มลงมือแก้ไขโค้ดหรือดำเนินการขั้นต่อไปทันที`,
        };
      }
    }

    // Pattern 2: Excessive read/listing loop without making modifications (Analysis Paralysis)
    // If prompt requires building/editing/fixing/creating, and agent has performed 4+ consecutive read operations
    const cleanPrompt = userPrompt.replace(/โครงสร้าง/g, '');
    const promptRequiresAction = /(สร้าง|แก้|เพิ่ม|ทำ|ย้าย|เขียน|create|build|implement|fix|modify|update|add|write|patch|migrate|refactor|install)/i.test(cleanPrompt);
    if (promptRequiresAction && window.length >= 4) {
      const lastFour = window.slice(-4);
      const isAllReadOnly = lastFour.every(tc =>
        tc.toolName === 'read_file' ||
        tc.toolName === 'list_directory' ||
        tc.toolName === 'search_files'
      );

      if (isAllReadOnly) {
        return {
          hasDrift: true,
          reason: 'Excessive read/inspect loop without implementing changes',
          directive: `📞 [Supervisor Alert - โทรสั่งงาน]: ตรวจพบว่างานเริ่มออกนอกลู่นอกทางหรือวนลูปอ่านไฟล์ (${lastFour.length} ครั้งต่อเนื่อง)! กรุณาหยุดอ่านไฟล์ซ้ำ และเริ่มลงมือแก้ไขโค้ด/เขียนไฟล์เพื่อตอบสนองคำสั่ง: "${userPrompt.slice(0, 80)}" ทันที!`,
        };
      }
    }

    return { hasDrift: false };
  }

  /**
   * Post-turn completion assessment ("ไล่เช็คงานยังไม่เสร็จก็สั่งงานต่อให้ไปอัตโนมัติ")
   * Inspects the session messages, goal status, and outputs to determine if the task
   * is truly finished or requires continuation.
   */
  async assessCompletion(
    userPrompt: string,
    messages: Message[],
    goal?: Goal
  ): Promise<SupervisorAssessment> {
    const lastMessage = messages.at(-1);

    // 1. Check for fatal or unrecovered errors
    const hasError = lastMessage?.metadata?.error || (lastMessage?.role === 'assistant' && lastMessage?.content?.includes('[Error]'));
    if (hasError) {
      const errorSnippet = lastMessage?.content?.slice(0, 150) || 'Error occurred';
      return {
        isCompleted: false,
        needsContinuation: true,
        reason: 'Task ended with an error',
        nextDirective: `👑 [Supervisor Directive - สั่งแก้ไขข้อผิดพลาด]: ตรวจพบข้อผิดพลาดระหว่างทำงาน: ${errorSnippet}\nกรุณาวิเคราะห์หาสาเหตุ แก้ไขปัญหานี้ และดำเนินงานต่อให้เสร็จสิ้น`,
      };
    }

    // 2. Check Reviewer rejection in Swarm
    const reviewerMsg = [...messages].reverse().find(m => m.role === 'assistant' && (m.name === 'reviewer' || m.content?.includes('Reviewer:')));
    if (reviewerMsg?.content) {
      const lower = reviewerMsg.content.toLowerCase();
      const isRejected = lower.includes('verdict: fail') || lower.includes('needs_revision') || lower.includes('ไม่ผ่าน') || lower.includes('ต้องแก้ไข');
      if (isRejected) {
        return {
          isCompleted: false,
          needsContinuation: true,
          reason: 'Reviewer rejected implementation',
          nextDirective: `👑 [Supervisor Directive - สั่งแก้ไขตามผลรีวิว]: ผลการรีวิวพบข้อบกพร่องที่ต้องแก้ไข:\n${reviewerMsg.content.slice(0, 300)}\n\nกรุณาลงมือแก้ไขจุดบกพร่องดังกล่าวให้เรียบร้อยและตรวจสอบใหม่`,
        };
      }
    }

    // 3. Check if user prompt requires implementation but no mutating tools were executed
    const cleanPrompt = userPrompt.replace(/โครงสร้าง/g, '');
    const promptRequiresAction = /(สร้าง|แก้|เพิ่ม|ทำ|ย้าย|เขียน|create|build|implement|fix|modify|update|add|write|patch|migrate|refactor|install)/i.test(cleanPrompt);
    if (promptRequiresAction) {
      const toolMessages = messages.filter(m => m.role === 'tool' || (m.role === 'assistant' && m.tool_calls?.length));
      const mutatingTools = ['write_file', 'patch_file', 'terminal'];
      const hasMutated = toolMessages.some(m => {
        if (m.name && mutatingTools.includes(m.name)) return true;
        if (m.tool_calls?.some(tc => mutatingTools.includes(tc.function.name))) return true;
        return false;
      });

      if (!hasMutated && toolMessages.length > 0) {
        return {
          isCompleted: false,
          needsContinuation: true,
          reason: 'Agent inspected workspace but has not implemented any code modifications yet',
          nextDirective: `👑 [Supervisor Directive - สั่งงานต่ออัตโนมัติ]: คุณได้สำรวจ/วางแผนแล้ว แต่ยังไม่ได้ลงมือแก้ไขหรือสร้างไฟล์จริงใน workspace กรุณาเริ่มสร้าง/แก้ไขไฟล์และทดสอบตามคำสั่ง: "${userPrompt}" ทันที!`,
        };
      }
    }

    // 4. Check terminal verification / test results
    const lastTerminalTool = [...messages].reverse().find(m => m.role === 'tool' && m.name === 'terminal');
    if (lastTerminalTool?.content) {
      const out = lastTerminalTool.content.toLowerCase();
      const hasFailure = (out.includes('fail') && !out.includes('0 fail') && !out.includes('0 failed')) ||
        out.includes('error:') ||
        (out.includes('[stderr]') && out.includes('tests failed'));
      if (hasFailure) {
        return {
          isCompleted: false,
          needsContinuation: true,
          reason: 'Verification tests failed in terminal',
          nextDirective: `👑 [Supervisor Directive - สั่งแก้เทสต์ที่ตก]: ผลการทดสอบยังไม่ผ่าน:\n${lastTerminalTool.content.slice(0, 300)}\n\nกรุณาตรวจสอบสาเหตุ แก้ไขโค้ด และรันการทดสอบใหม่จนกว่าจะผ่านทุกรายการ`,
        };
      }
    }

    // 5. Check Goal steps completion
    if (goal && Array.isArray(goal.steps) && goal.steps.length > 0) {
      const pendingSteps = goal.steps.filter(s => s.status !== 'completed');
      if (pendingSteps.length > 0) {
        const stepTitles = pendingSteps.map(s => `- ${s.title}`).join('\n');
        return {
          isCompleted: false,
          needsContinuation: true,
          pendingMilestones: pendingSteps.map(s => s.title),
          reason: `Pending goal milestones remain (${pendingSteps.length}/${goal.steps.length})`,
          nextDirective: `👑 [Supervisor Directive - สั่งทำขั้นตอนถัดไป]: ยังมีขั้นตอนตามเป้าหมายที่ต้องดำเนินการต่อ:\n${stepTitles}\n\nกรุณาดำเนินการขั้นตอนข้างต้นต่อให้เสร็จสิ้น`,
        };
      }
    }

    // 6. If an LLM client is available and prompt is complex, perform a fast validation pass
    if (this.llmConfig?.apiKey && messages.length > 4) {
      try {
        const client = new LLMClient({ ...this.llmConfig, maxRetries: 2, retryDelayMs: 200 });
        const lastAssistantContent = [...messages].reverse().find(m => m.role === 'assistant' && m.content?.trim())?.content || '';
        const checkPrompt = [
          'You are the Lead Supervisor Agent in Project Alisa Studio.',
          'Assess if the user request has been completely implemented and verified in the workspace.',
          `Original user request: "${userPrompt}"`,
          `Recent assistant report: "${lastAssistantContent.slice(-1000)}"`,
          'If work is incomplete or has unaddressed items, reply exactly in this format:',
          'STATUS: INCOMPLETE',
          'DIRECTIVE: [Specific next instruction for the worker in Thai]',
          'If all requested work is finished and verified, reply exactly:',
          'STATUS: COMPLETED',
        ].join('\n\n');

        const result = await client.chatStream(
          [{ id: 'sup_check', role: 'user', content: checkPrompt, timestamp: Date.now() }],
          [],
          {}
        );

        if (result.content.includes('STATUS: INCOMPLETE')) {
          const match = result.content.match(/DIRECTIVE:\s*([\s\S]+)/i);
          const directive = match ? match[1].trim() : `กรุณาดำเนินการส่วนที่เหลือตามคำสั่ง "${userPrompt}" ให้เสร็จสิ้น`;
          return {
            isCompleted: false,
            needsContinuation: true,
            reason: 'Supervisor model determined work is incomplete',
            nextDirective: `👑 [Supervisor Directive - สั่งงานต่ออัตโนมัติ]: ${directive}`,
          };
        }
      } catch {
        // Fall back to heuristic completion
      }
    }

    return {
      isCompleted: true,
      needsContinuation: false,
      reason: 'All milestones completed and verified.',
    };
  }
}
