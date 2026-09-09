import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../core/types.ts';

export const ManageSkillInputSchema = z.object({
  action: z.enum(['list', 'read', 'load']).describe('Skill action'),
  name: z.string().optional().describe('Skill name to read or load'),
});

export const manageSkillTool: ToolDefinition<z.infer<typeof ManageSkillInputSchema>, any> = {
  name: 'manage_skill',
  description: 'Discover, inspect, and load domain skills dynamically from AppData/Local/hermes/skills.',
  parameters: ManageSkillInputSchema,
  execute: async (args, context) => {
    const userHome = process.env.USERPROFILE || process.env.HOME || process.cwd();
    const skillsBase = path.join(userHome, 'AppData', 'Local', 'hermes', 'skills');

    if (args.action === 'list') {
      if (!fs.existsSync(skillsBase)) {
        return { skills: [] };
      }
      const files: string[] = [];
      function scanDir(dir: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const res = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(res);
          } else if (entry.name.toLowerCase() === 'skill.md') {
            const relative = path.relative(skillsBase, path.dirname(res));
            files.push(relative.replace(/\\/g, '/'));
          }
        }
      }
      scanDir(skillsBase);
      return { skills: files };
    }

    if (args.action === 'read' || args.action === 'load') {
      if (!args.name) {
        throw new Error('Skill name is required');
      }
      
      // Search for skill matching name
      let skillPath = path.join(skillsBase, args.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) {
        // Fallback recursive search
        let foundPath = '';
        function findSkill(dir: string) {
          if (!fs.existsSync(dir)) return;
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const res = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (entry.name === args.name) {
                const candidate = path.join(res, 'SKILL.md');
                if (fs.existsSync(candidate)) {
                  foundPath = candidate;
                  return;
                }
              }
              findSkill(res);
            }
          }
        }
        findSkill(skillsBase);
        if (foundPath) {
          skillPath = foundPath;
        } else {
          throw new Error(`Skill "${args.name}" not found in ${skillsBase}`);
        }
      }

      const content = fs.readFileSync(skillPath, 'utf-8');
      return {
        name: args.name,
        path: skillPath,
        content,
      };
    }

    return { error: 'Invalid action' };
  }
};
