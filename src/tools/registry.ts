import type { ToolDefinition } from '../core/types.ts';
import { terminalTool } from './terminal.ts';
import { readFileTool, writeFileTool, patchFileTool, listDirTool } from './file-ops.ts';
import { searchFilesTool } from './search.ts';
import { manageSkillTool } from './skill-ops.ts';
import { updatePlanTool } from './plan.ts';
import { updateGoalTool } from './goal.ts';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  constructor() {
    this.register(terminalTool);
    this.register(readFileTool);
    this.register(writeFileTool);
    this.register(patchFileTool);
    this.register(listDirTool);
    this.register(searchFilesTool);
    this.register(manageSkillTool);
    this.register(updatePlanTool);
    this.register(updateGoalTool);
  }

  register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Convert registered tools into OpenAI-compatible tool specifications
   */
  toOpenAITools() {
    return this.getAll().map(tool => {
      // Basic schema generator
      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: (tool.parameters as any)._def ? this.zodSchemaToJson(tool.parameters) : {},
        }
      };
    });
  }

  private zodSchemaToJson(schema: any): Record<string, any> {
    const def = schema._def;
    let result: Record<string, any>;
    switch (def.typeName) {
      case 'ZodOptional': case 'ZodDefault':
        result = this.zodSchemaToJson(def.innerType); break;
      case 'ZodString': result = { type: 'string' }; break;
      case 'ZodNumber': result = { type: 'number' }; break;
      case 'ZodBoolean': result = { type: 'boolean' }; break;
      case 'ZodEnum': result = { type: 'string', enum: def.values }; break;
      case 'ZodLiteral': result = { type: typeof def.value, enum: [def.value] }; break;
      case 'ZodArray': result = { type: 'array', items: this.zodSchemaToJson(def.type) }; break;
      case 'ZodObject': {
        const properties: Record<string, any> = {};
        const required: string[] = [];
        for (const [key, value] of Object.entries<any>(def.shape())) {
          properties[key] = this.zodSchemaToJson(value);
          if (!value.isOptional()) required.push(key);
        }
        result = { type: 'object', properties, required }; break;
      }
      default: throw new Error(`Unsupported tool parameter schema: ${def.typeName}`);
    }
    if (schema.description) result.description = schema.description;
    return result;
  }
}
