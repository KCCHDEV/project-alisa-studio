import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDefinition } from '../core/types.ts';
import { terminalTool } from './terminal.ts';
import { readFileTool, writeFileTool, patchFileTool, listDirTool } from './file-ops.ts';
import { searchFilesTool } from './search.ts';
import { manageSkillTool } from './skill-ops.ts';

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
    try {
      const shape = schema._def?.shape?.() || schema.shape || {};
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [key, propSchema] of Object.entries<any>(shape)) {
        let typeName = 'string';
        let description = (propSchema._def?.description) || '';
        let isOptional = false;

        let def = propSchema._def;
        while (def) {
          if (def.typeName === 'ZodOptional' || def.typeName === 'ZodDefault') {
            isOptional = true;
            def = def.innerType?._def;
          } else if (def.typeName === 'ZodNumber') {
            typeName = 'number';
            break;
          } else if (def.typeName === 'ZodBoolean') {
            typeName = 'boolean';
            break;
          } else if (def.typeName === 'ZodArray') {
            typeName = 'array';
            break;
          } else if (def.typeName === 'ZodObject') {
            typeName = 'object';
            break;
          } else {
            break;
          }
        }

        properties[key] = {
          type: typeName,
          description,
        };

        if (!isOptional) {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required,
      };
    } catch {
      return { type: 'object', properties: {} };
    }
  }
}
