import { test, expect, describe } from 'bun:test';
import { TaskSupervisor } from '../src/core/supervisor';
import type { Goal, Message } from '../src/core/types';

describe('TaskSupervisor', () => {
  describe('recordToolCallAndCheckDrift (Real-time Watchdog)', () => {
    test('does not report drift for normal distinct tool calls', () => {
      const supervisor = new TaskSupervisor();
      const prompt = 'ช่วยแก้โค้ดใน index.ts หน่อย';

      expect(supervisor.recordToolCallAndCheckDrift('read_file', { path: 'index.ts' }, prompt).hasDrift).toBe(false);
      expect(supervisor.recordToolCallAndCheckDrift('write_file', { path: 'index.ts', content: 'console.log(1)' }, prompt).hasDrift).toBe(false);
      expect(supervisor.recordToolCallAndCheckDrift('terminal', { command: 'bun test' }, prompt).hasDrift).toBe(false);
    });

    test('detects duplicate back-to-back tool calls with same arguments', () => {
      const supervisor = new TaskSupervisor();
      const prompt = 'ช่วยแก้โค้ดหน่อย';

      supervisor.recordToolCallAndCheckDrift('read_file', { path: 'package.json' }, prompt);
      const res = supervisor.recordToolCallAndCheckDrift('read_file', { path: 'package.json' }, prompt);

      expect(res.hasDrift).toBe(true);
      expect(res.reason).toContain('Duplicate tool call');
      expect(res.directive).toContain('📞 [Supervisor Alert - โทรสั่งงาน]');
      expect(res.directive).toContain('ซ้ำซ้อน');
    });

    test('detects excessive read/inspect loop when user requested modifications', () => {
      const supervisor = new TaskSupervisor();
      const prompt = 'สร้างไฟล์ utils.ts และเขียนฟังก์ชันคำนวณภาษี';

      expect(supervisor.recordToolCallAndCheckDrift('read_file', { path: 'a.ts' }, prompt).hasDrift).toBe(false);
      expect(supervisor.recordToolCallAndCheckDrift('read_file', { path: 'b.ts' }, prompt).hasDrift).toBe(false);
      expect(supervisor.recordToolCallAndCheckDrift('list_directory', { path: 'src' }, prompt).hasDrift).toBe(false);

      // 4th consecutive read/list call
      const res = supervisor.recordToolCallAndCheckDrift('search_files', { query: 'tax' }, prompt);
      expect(res.hasDrift).toBe(true);
      expect(res.reason).toContain('Excessive read/inspect loop');
      expect(res.directive).toContain('📞 [Supervisor Alert - โทรสั่งงาน]');
      expect(res.directive).toContain('วนลูปอ่านไฟล์');
    });

    test('does not flag read loop if user prompt was purely informational (read-only)', () => {
      const supervisor = new TaskSupervisor();
      const prompt = 'อธิบายโค้ดโครงสร้างโปรเจกต์นี้ให้ฟังหน่อย';

      supervisor.recordToolCallAndCheckDrift('read_file', { path: 'a.ts' }, prompt);
      supervisor.recordToolCallAndCheckDrift('read_file', { path: 'b.ts' }, prompt);
      supervisor.recordToolCallAndCheckDrift('list_directory', { path: 'src' }, prompt);
      const res = supervisor.recordToolCallAndCheckDrift('search_files', { query: 'doc' }, prompt);

      // Informational prompt does not force mutating tools
      expect(res.hasDrift).toBe(false);
    });

    test('reset clears sliding window history', () => {
      const supervisor = new TaskSupervisor();
      const prompt = 'แก้โค้ด';

      supervisor.recordToolCallAndCheckDrift('read_file', { path: 'a.ts' }, prompt);
      supervisor.reset();
      // Repeating after reset should not trigger duplicate because history was cleared
      const res = supervisor.recordToolCallAndCheckDrift('read_file', { path: 'a.ts' }, prompt);
      expect(res.hasDrift).toBe(false);
    });
  });

  describe('assessCompletion (Post-Run Goal & Completion Checker)', () => {
    test('flags error when last message has error metadata or content', async () => {
      const supervisor = new TaskSupervisor();
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'run tests', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          content: '[Error] Execution timed out',
          timestamp: 2,
          metadata: { error: true },
        },
      ];

      const assessment = await supervisor.assessCompletion('run tests', messages);
      expect(assessment.isCompleted).toBe(false);
      expect(assessment.needsContinuation).toBe(true);
      expect(assessment.nextDirective).toContain('👑 [Supervisor Directive - สั่งแก้ไขข้อผิดพลาด]');
    });

    test('flags continuation when reviewer in swarm rejects code', async () => {
      const supervisor = new TaskSupervisor();
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'เพิ่มฟังก์ชัน login', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          name: 'reviewer',
          content: 'Verdict: FAIL - ยังขาด unit tests และ validation schema ไม่ผ่าน',
          timestamp: 2,
        },
      ];

      const assessment = await supervisor.assessCompletion('เพิ่มฟังก์ชัน login', messages);
      expect(assessment.isCompleted).toBe(false);
      expect(assessment.needsContinuation).toBe(true);
      expect(assessment.reason).toContain('Reviewer rejected');
      expect(assessment.nextDirective).toContain('👑 [Supervisor Directive - สั่งแก้ไขตามผลรีวิว]');
    });

    test('flags unmutated workspace when user requested implementation but agent only read files', async () => {
      const supervisor = new TaskSupervisor();
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'สร้าง helper formatPrice ใน utils.ts', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          content: 'Let me read the directory first',
          timestamp: 2,
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'list_directory', arguments: '{}' } }],
        },
        { id: '3', role: 'tool', name: 'list_directory', content: '["package.json"]', tool_call_id: 'tc1', timestamp: 3 },
        { id: '4', role: 'assistant', content: 'I have inspected the project and see package.json.', timestamp: 4 },
      ];

      const assessment = await supervisor.assessCompletion('สร้าง helper formatPrice ใน utils.ts', messages);
      expect(assessment.isCompleted).toBe(false);
      expect(assessment.needsContinuation).toBe(true);
      expect(assessment.reason).toContain('has not implemented any code modifications');
      expect(assessment.nextDirective).toContain('👑 [Supervisor Directive - สั่งงานต่ออัตโนมัติ]');
    });

    test('flags continuation when terminal verification tests fail', async () => {
      const supervisor = new TaskSupervisor();
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'เขียน test สำหรับ math.ts', timestamp: 1 },
        { id: '2', role: 'tool', name: 'write_file', content: 'ok', tool_call_id: 'tc1', timestamp: 2 },
        {
          id: '3',
          role: 'tool',
          name: 'terminal',
          content: 'FAIL tests/math.test.ts: 2 tests failed, 0 passed',
          tool_call_id: 'tc2',
          timestamp: 3,
        },
        { id: '4', role: 'assistant', content: 'Done writing the test.', timestamp: 4 },
      ];

      const assessment = await supervisor.assessCompletion('เขียน test สำหรับ math.ts', messages);
      expect(assessment.isCompleted).toBe(false);
      expect(assessment.needsContinuation).toBe(true);
      expect(assessment.reason).toContain('Verification tests failed');
      expect(assessment.nextDirective).toContain('👑 [Supervisor Directive - สั่งแก้เทสต์ที่ตก]');
    });

    test('flags continuation when goal has pending milestones', async () => {
      const supervisor = new TaskSupervisor();
      const goal: Goal = {
        id: 'g1',
        title: 'Full feature implementation',
        description: 'Implement backend and frontend',
        status: 'active',
        progress: 50,
        createdAt: 1,
        updatedAt: 2,
        steps: [
          { id: 's1', title: 'Create backend API', status: 'completed' },
          { id: 's2', title: 'Create frontend UI', status: 'pending' },
        ],
      };

      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Implement backend and frontend', timestamp: 1 },
        { id: '2', role: 'tool', name: 'write_file', content: 'ok', tool_call_id: 'tc1', timestamp: 2 },
        { id: '3', role: 'assistant', content: 'Backend API created.', timestamp: 3 },
      ];

      const assessment = await supervisor.assessCompletion('Implement backend and frontend', messages, goal);
      expect(assessment.isCompleted).toBe(false);
      expect(assessment.needsContinuation).toBe(true);
      expect(assessment.pendingMilestones).toEqual(['Create frontend UI']);
      expect(assessment.nextDirective).toContain('👑 [Supervisor Directive - สั่งทำขั้นตอนถัดไป]');
      expect(assessment.nextDirective).toContain('Create frontend UI');
    });

    test('confirms completion when all conditions are satisfied', async () => {
      const supervisor = new TaskSupervisor();
      const goal: Goal = {
        id: 'g1',
        title: 'Feature',
        description: 'Done',
        status: 'completed',
        progress: 100,
        createdAt: 1,
        updatedAt: 2,
        steps: [
          { id: 's1', title: 'Step 1', status: 'completed' },
        ],
      };

      const messages: Message[] = [
        { id: '1', role: 'user', content: 'สร้างไฟล์ test.txt', timestamp: 1 },
        { id: '2', role: 'tool', name: 'write_file', content: 'ok', tool_call_id: 'tc1', timestamp: 2 },
        { id: '3', role: 'tool', name: 'terminal', content: '1 passed (pass)', tool_call_id: 'tc2', timestamp: 3 },
        { id: '4', role: 'assistant', content: 'All done and verified successfully!', timestamp: 4 },
      ];

      const assessment = await supervisor.assessCompletion('สร้างไฟล์ test.txt', messages, goal);
      expect(assessment.isCompleted).toBe(true);
      expect(assessment.needsContinuation).toBe(false);
      expect(assessment.reason).toContain('All milestones completed and verified');
    });
  });
});
