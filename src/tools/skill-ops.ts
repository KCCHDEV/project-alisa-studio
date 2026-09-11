import { discoverSkills } from '../core/skills';
import { z } from 'zod';
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
    const skills = discoverSkills(context.cwd);
    if (args.action === 'list') return { skills: skills.map(({ content, ...entry }) => entry) };
    const skill = skills.find(s => s.name === args.name);
    if (!skill) throw new Error('Skill not found in the active catalog');
    return skill;
  },
};
