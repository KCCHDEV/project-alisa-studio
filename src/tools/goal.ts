import { z } from 'zod';
import type { Goal, GoalStep, ToolDefinition } from '../core/types.ts';

const GoalStepSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(240),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
});

export const UpdateGoalInputSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['active', 'completed', 'paused', 'blocked']).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  steps: z.array(GoalStepSchema).max(30).optional(),
});

export type UpdateGoalInput = z.infer<typeof UpdateGoalInputSchema>;

function createGoal(args: UpdateGoalInput, current?: Goal): Goal {
  const now = Date.now();
  return {
    id: current?.id || `goal_${now}`,
    title: args.title || current?.title || 'Untitled goal',
    description: args.description ?? current?.description ?? '',
    status: args.status || current?.status || 'active',
    progress: args.progress ?? current?.progress ?? 0,
    steps: (args.steps || current?.steps || []) as GoalStep[],
    createdAt: current?.createdAt || now,
    updatedAt: now,
  };
}

export const updateGoalTool: ToolDefinition<UpdateGoalInput, { success: boolean; goal: Goal }> = {
  name: 'update_goal',
  description: 'Create or update the persistent session goal. Keep progress honest and update steps as the implementation moves forward.',
  parameters: UpdateGoalInputSchema,
  execute: async (args, context) => {
    const goal = createGoal(args, context.goal);
    if (context.updateGoal) context.updateGoal(goal);
    else context.emitEvent({ type: 'goal_update', goal });
    return { success: true, goal };
  },
};

