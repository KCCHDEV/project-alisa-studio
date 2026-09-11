import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverSkills } from '../src/core/skills';
import { detectCapabilities } from '../src/core/capabilities';

test('bundles MCP and Computer Use skills and detects local MCP configs safely', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'alisa-capabilities-'));
  try {
    writeFileSync(join(workspace, '.mcp.json'), JSON.stringify({ mcpServers: { docs: { command: 'node', args: ['server.js'] } } }));
    const skills = discoverSkills(workspace);
    expect(skills.some(skill => skill.name === 'mcp' && skill.category === 'built-in')).toBe(true);
    expect(skills.some(skill => skill.name === 'computer-use' && skill.category === 'built-in')).toBe(true);
    const status = detectCapabilities(workspace);
    expect(status.mcp.skillInstalled).toBe(true);
    expect(status.mcp.serverCount).toBe(1);
    expect(status.mcp.configuredFiles.some(entry => entry.path === join(workspace, '.mcp.json'))).toBe(true);
    expect(status.computerUse.skillInstalled).toBe(true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
