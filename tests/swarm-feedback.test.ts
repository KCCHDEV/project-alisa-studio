import { test, expect } from 'bun:test';
import { SwarmRunner, checkReviewVerdict } from '../src/core/swarm.ts';

test('checkReviewVerdict correctly identifies pass, fail, needs_revision, and Thai keywords', () => {
  expect(checkReviewVerdict('VERDICT: PASS\nAll tests pass.').passed).toBe(true);
  expect(checkReviewVerdict('VERDICT: PASS\nAll tests pass.').needsRevision).toBe(false);

  expect(checkReviewVerdict('VERDICT: FAIL\nFound 2 syntax errors.').passed).toBe(false);
  expect(checkReviewVerdict('VERDICT: FAIL\nFound 2 syntax errors.').needsRevision).toBe(true);

  expect(checkReviewVerdict('VERDICT: NEEDS_REVISION\nPlease add unit tests.').passed).toBe(false);
  expect(checkReviewVerdict('VERDICT: NEEDS_REVISION\nPlease add unit tests.').needsRevision).toBe(true);

  expect(checkReviewVerdict('การทดสอบไม่ผ่าน ต้องแก้ไขฟังก์ชันใน utils.ts').passed).toBe(false);
  expect(checkReviewVerdict('การทดสอบไม่ผ่าน ต้องแก้ไขฟังก์ชันใน utils.ts').needsRevision).toBe(true);

  expect(checkReviewVerdict('Normal worker report with no issues').passed).toBe(true);
  expect(checkReviewVerdict('Normal worker report with no issues').needsRevision).toBe(false);
});

test('SwarmRunner sends work back to Builder when Reviewer rejects and succeeds after rework', async () => {
  let step = 0;
  const workerPrompts: string[] = [];
  const events: any[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      step++;
      const body = await req.json();
      const lastUserMsg = body.messages?.findLast((m: any) => m.role === 'user')?.content || '';
      workerPrompts.push(lastUserMsg);

      let responseContent = 'Report done';
      if (step === 1) {
        responseContent = 'Explorer: Found target files in src/';
      } else if (step === 2) {
        responseContent = 'Planner: Plan created with 2 steps';
      } else if (step === 3) {
        responseContent = 'Builder: Implemented initial version (has bug)';
      } else if (step === 4) {
        // Reviewer rejects!
        responseContent = 'Reviewer: Checked code.\nVERDICT: FAIL\nCritical bug in math calculation.';
      } else if (step === 5) {
        // Builder receives rework feedback and fixes it
        responseContent = 'Builder: Fixed the math calculation bug and verified tests.';
      } else if (step === 6) {
        // Reviewer re-reviews and approves!
        responseContent = 'Reviewer: Re-checked the fixes. All calculations correct.\nVERDICT: PASS';
      }

      return new Response(
        'data: ' +
          JSON.stringify({
            model: 'test-model',
            choices: [{ delta: { content: responseContent }, finish_reason: 'stop' }],
          }) +
          '\n\ndata: [DONE]\n',
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    },
  });

  try {
    const runner = new SwarmRunner({
      cwd: process.cwd(),
      sessionId: 'swarm-rework-test',
      prompt: 'Fix the math calculation',
      history: [],
      maxRetries: 5,
      llmConfig: { baseURL: server.url.toString(), apiKey: '', model: 'test-route', maxRetries: 5 },
      onEvent: event => events.push(event),
    });

    const result = await runner.run();

    expect(result.status).toBe('done');
    // Step 1: Explorer, Step 2: Planner, Step 3: Builder, Step 4: Reviewer (fail), Step 5: Builder (rework), Step 6: Reviewer (pass)
    expect(step).toBe(6);

    // Verify self_correcting event was emitted when Reviewer rejected
    const selfCorrectingEvents = events.filter(
      e => e.type === 'status_change' && e.status === 'self_correcting'
    );
    expect(selfCorrectingEvents.length).toBeGreaterThan(0);
    expect(selfCorrectingEvents.some(e => e.detail?.includes('Builder'))).toBe(true);

    // Verify Builder prompt in Step 5 received Reviewer feedback
    expect(workerPrompts[4]).toContain('REWORK REQUIRED');
    expect(workerPrompts[4]).toContain('Critical bug in math calculation');

    // Verify final state of all agents is 'done'
    expect(result.agents.every(a => a.status === 'done')).toBe(true);
    expect(result.detail).toContain('passed after 1 revision cycle');
  } finally {
    server.stop(true);
  }
});

test('SwarmRunner auto-retries when a worker errors and succeeds on subsequent attempt', async () => {
  let explorerAttempts = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      explorerAttempts++;
      if (explorerAttempts === 1) {
        // Return 529 overload on first attempt
        return new Response('Site Overloaded', { status: 529 });
      }
      return new Response(
        'data: ' +
          JSON.stringify({
            model: 'test-model',
            choices: [{ delta: { content: 'Worker succeeded on retry' }, finish_reason: 'stop' }],
          }) +
          '\n\ndata: [DONE]\n',
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    },
  });

  try {
    const runner = new SwarmRunner({
      cwd: process.cwd(),
      sessionId: 'swarm-retry-worker-test',
      prompt: 'Test retry worker',
      history: [],
      maxRetries: 3,
      llmConfig: { baseURL: server.url.toString(), apiKey: '', model: 'test-route', maxRetries: 3, retryDelayMs: 10 },
    });

    const result = await runner.run();
    expect(result.status).toBe('done');
    expect(explorerAttempts).toBeGreaterThanOrEqual(2);
  } finally {
    server.stop(true);
  }
});

test('SwarmRunner completes all 4 agents even when Builder finishes via tool cycle without initial text', async () => {
  let callCount = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      callCount++;
      const body = await req.json();
      const lastUserMsg = body.messages?.findLast((m: any) => m.role === 'user')?.content || '';

      if (lastUserMsg.includes('Explorer')) {
        return new Response(
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Explorer: Inspected project files.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n',
          { headers: { 'Content-Type': 'text/event-stream' } }
        );
      }
      if (lastUserMsg.includes('Planner')) {
        return new Response(
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Planner: Checklist ready.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n',
          { headers: { 'Content-Type': 'text/event-stream' } }
        );
      }
      if (lastUserMsg.includes('Builder')) {
        // Builder executes a tool call
        if (!body.messages.some((m: any) => m.role === 'tool')) {
          return new Response(
            'data: ' + JSON.stringify({
              choices: [{
                delta: {
                  content: '',
                  tool_calls: [{ id: 'call_1', function: { name: 'list_directory', arguments: '{"path":"."}' } }]
                },
                finish_reason: 'tool_calls'
              }]
            }) + '\n\ndata: [DONE]\n',
            { headers: { 'Content-Type': 'text/event-stream' } }
          );
        }
        // After tool, builder responds with completion text
        return new Response(
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Builder: Directory inspected and implementation finished.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n',
          { headers: { 'Content-Type': 'text/event-stream' } }
        );
      }
      // Reviewer
      return new Response(
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Reviewer: All changes verified.\nVERDICT: PASS' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n',
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    },
  });

  try {
    const runner = new SwarmRunner({
      cwd: process.cwd(),
      sessionId: 'swarm-tool-complete-test',
      prompt: 'Inspect and build',
      history: [],
      maxRetries: 3,
      llmConfig: { baseURL: server.url.toString(), apiKey: '', model: 'test-route', maxRetries: 3 },
    });

    const result = await runner.run();
    expect(result.status).toBe('done');
    expect(result.agents.filter(a => a.status === 'done').length).toBe(4);
    expect(result.detail).toContain('4/4 agents completed');
  } finally {
    server.stop(true);
  }
});

