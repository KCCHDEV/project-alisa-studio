import * as readline from 'readline';
import * as path from 'path';
import { Agent } from '../core/agent.ts';
import { LLMClient } from '../llm/client.ts';
import type { Message, AgentEvent } from '../core/types.ts';

const BANNER = `
\x1b[38;5;75m
  PROJECT ALISA STUDIO CLI — v1.0.0
  -----------------------------------------
  Personal Autonomous Coding Harness
\x1b[0m`;

async function main() {
  console.clear();
  console.log(BANNER);

  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';
  const baseURL = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';
  const model = process.env.ALISA_MODEL || process.env.ICHIGO_MODEL || 'deepseek/deepseek-chat';
  const cwd = process.cwd();

  console.log(`\x1b[90m[Workspace] ${cwd}\x1b[0m`);
  console.log(`\x1b[90m[Model]     ${model}\x1b[0m`);
  console.log(`\x1b[90m[Base URL]  ${baseURL}\x1b[0m\n`);

  const llm = new LLMClient({ apiKey, baseURL, model });
  
  const agent = new Agent({
    cwd,
    llm,
    requestApproval: (action, details, signal) => new Promise(resolve => {
      if (signal.aborted) { resolve(false); return; }
      rl.question(`\nAllow ${action}: ${JSON.stringify(details)}? [y/N] `, answer => resolve(answer.trim().toLowerCase() === 'y'));
    }),
    onEvent: (event: AgentEvent) => {
      if (event.type === 'token_stream') {
        process.stdout.write(event.delta);
      } else if (event.type === 'thought_stream') {
        process.stdout.write(`\x1b[33m${event.delta}\x1b[0m`);
      } else if (event.type === 'tool_call_start') {
        console.log(`\n\x1b[36m[TOOL] Executing [${event.toolName}]...\x1b[0m \x1b[90m${JSON.stringify(event.args)}\x1b[0m`);
      } else if (event.type === 'tool_call_end') {
        if (event.error) {
          console.log(`\x1b[31m[TOOL ERROR]\x1b[0m ${event.error}`);
        } else {
          console.log(`\x1b[32m[TOOL DONE]\x1b[0m`);
        }
      } else if (event.type === 'status_change') {
        if (event.status === 'thinking') {
          console.log(`\n\x1b[35m[THINKING] Processing...\x1b[0m`);
        }
      }
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let history: Message[] = [];

  const askPrompt = () => {
    rl.question('\n\x1b[38;5;75mAlisa > \x1b[0m', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        askPrompt();
        return;
      }
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log('\n\x1b[32mGoodbye!\x1b[0m');
        rl.close();
        process.exit(0);
      }

      try {
        const updated = await agent.runTask(trimmed, history);
        history = updated;
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      }

      askPrompt();
    });
  };

  askPrompt();
}

main().catch(console.error);
