import { z } from 'zod';
import type { PlanItem, ToolDefinition } from '../core/types.ts';

export const UpdatePlanInputSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1).max(80),
    title: z.string().trim().min(1).max(240),
    status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
  })).max(30),
});

export const updatePlanTool: ToolDefinition<z.infer<typeof UpdatePlanInputSchema>, { success: boolean; items: PlanItem[] }> = {
  name: 'update_plan',
  description: 'Create or update the visible task checklist. Use this for multi-step work; keep items short and update their status as work progresses.',
  parameters: UpdatePlanInputSchema,
  execute: async (args, context) => {
    const items = args.items as PlanItem[];
    context.emitEvent({ type: 'plan_update', items });
    return { success: true, items };
  },
};

