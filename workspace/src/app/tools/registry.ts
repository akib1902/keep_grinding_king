/**
 * Typed tool registry — SRS-AGENT-001..003.
 *
 * The agent can only ever invoke a capability that is registered here. Two
 * independent checks apply to every call:
 *
 *   1. The tool name must exist in the registry (no arbitrary SQL, no shell, no
 *      ledger access).
 *   2. The arguments must satisfy the tool's Zod schema before any handler runs,
 *      and the result is validated again before it is handed back to the model.
 *
 * The same Zod definition produces the JSON Schema advertised to the model, so
 * what the model is told and what the runtime enforces cannot drift apart.
 */
import { z } from 'zod';
import { AppError, ErrorCode, isAppError } from '../../domain/errors.js';
import type { LlmToolSchema } from '../ports.js';

export type ToolEffect = 'READ' | 'WRITE';

export type ToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  /**
   * Args schema — validated on every invocation.
   *
   * Declared with `z.ZodType<TArgs, z.ZodTypeDef, unknown>` so `TArgs` is inferred
   * from the schema's *output* type: a field written as
   * `z.number().default(25)` reaches the handler as a `number`, never as
   * `number | undefined`.
   */
  argsSchema: z.ZodType<TArgs, z.ZodTypeDef, unknown>;
  /** Result schema — validated before the model sees the data. */
  resultSchema: z.ZodType<TResult>;
  effect: ToolEffect;
  execute(args: TArgs, context: unknown): Promise<TResult>;
}

export class ToolRegistry<TContext> {
  readonly #tools = new Map<string, ToolDefinition<never, unknown>>();

  register<TArgs, TResult>(definition: ToolDefinition<TArgs, TResult>): void {
    if (this.#tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered.`);
    }
    this.#tools.set(definition.name, definition as unknown as ToolDefinition<never, unknown>);
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  /**
   * Structural description of a registered tool. Used by the schema-drift test,
   * which asserts that what the model is told matches what the runtime enforces.
   */
  describe(name: string): { name: string; effect: ToolEffect; argsSchema: z.ZodTypeAny; resultSchema: z.ZodTypeAny } | null {
    const tool = this.#tools.get(name);
    if (!tool) return null;
    return { name: tool.name, effect: tool.effect, argsSchema: tool.argsSchema, resultSchema: tool.resultSchema };
  }

  names(): string[] {
    return [...this.#tools.keys()].sort();
  }

  /** Tool declarations advertised to the model. */
  declarations(): LlmToolSchema[] {
    return this.names().map((name) => {
      const tool = this.#tools.get(name) as ToolDefinition<never, unknown>;
      return {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.argsSchema),
      };
    });
  }

  async invoke(name: string, rawArgs: unknown, context: TContext): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (!tool) {
      return {
        ok: false,
        error: {
          code: ErrorCode.TOOL_NOT_REGISTERED,
          message: `Tool "${name}" is not registered and cannot be invoked.`,
          retryable: false,
        },
      };
    }

    const parsedArgs = tool.argsSchema.safeParse(rawArgs);
    if (!parsedArgs.success) {
      return {
        ok: false,
        error: {
          code: ErrorCode.TOOL_ARGUMENT_INVALID,
          message: `Arguments for "${name}" failed schema validation.`,
          retryable: false,
        },
      };
    }

    try {
      const data = await (tool.execute as (args: unknown, ctx: TContext) => Promise<unknown>)(parsedArgs.data, context);
      const parsedResult = tool.resultSchema.safeParse(data);
      if (!parsedResult.success) {
        return {
          ok: false,
          error: {
            code: ErrorCode.TOOL_EXECUTION_FAILED,
            message: `Tool "${name}" returned a result that failed schema validation.`,
            retryable: false,
          },
        };
      }
      return { ok: true, data: parsedResult.data };
    } catch (error) {
      const appError = isAppError(error) ? error : undefined;
      return {
        ok: false,
        error: {
          code: appError?.code ?? ErrorCode.TOOL_EXECUTION_FAILED,
          message: appError?.message ?? `Tool "${name}" failed.`,
          // Retry decisions belong to the runtime and workflow policy (SRS §8).
          retryable: appError?.retryable ?? false,
        },
      };
    }
  }
}

export function defineTool<TArgs, TResult>(definition: {
  name: string;
  description: string;
  argsSchema: z.ZodType<TArgs, z.ZodTypeDef, unknown>;
  resultSchema: z.ZodType<TResult>;
  effect: ToolEffect;
  execute(args: TArgs, context: never): Promise<TResult>;
}): ToolDefinition<TArgs, TResult> {
  return definition as ToolDefinition<TArgs, TResult>;
}

/** Failure helper used inside handlers. */
export function toolFailure(code: string, message: string, retryable = false): AppError {
  return new AppError({ code, message, category: 'VALIDATION', httpStatus: 400, retryable });
}

// ---------------------------------------------------------------------------
// Zod → JSON Schema (subset)
// ---------------------------------------------------------------------------

/**
 * Converts the Zod constructs used by this project into JSON Schema. Only the
 * subset below is supported and `tests/unit/tool-registry.test.ts` asserts the
 * generated schema matches each tool's Zod shape, so the adapter cannot silently
 * fall behind: an unsupported construct throws instead of degrading.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const result = convert(schema);
  if (!result || typeof result !== 'object') {
    throw new Error('Tool schemas must be Zod objects.');
  }
  return result as Record<string, unknown>;
}

function convert(schema: z.ZodTypeAny): unknown {
  const description = schema.description;

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return convert(schema._def.innerType);
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convert(value);
      const isOptional = value.isOptional() || value instanceof z.ZodDefault;
      if (!isOptional) required.push(key);
    }
    return {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
      ...(description ? { description } : {}),
    };
  }

  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: convert(schema.element as z.ZodTypeAny), ...(description ? { description } : {}) };
  }

  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: [...(schema.options as string[])], ...(description ? { description } : {}) };
  }

  if (schema instanceof z.ZodLiteral) {
    return { const: schema.value, ...(description ? { description } : {}) };
  }

  if (schema instanceof z.ZodString) {
    const checks = checksOf(schema);
    return { type: 'string', ...checks, ...(description ? { description } : {}) };
  }

  if (schema instanceof z.ZodNumber) {
    const checks = checksOf(schema);
    return { type: 'number', ...checks, ...(description ? { description } : {}) };
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean', ...(description ? { description } : {}) };
  }

  if (schema instanceof z.ZodRecord) {
    return { type: 'object', additionalProperties: true, ...(description ? { description } : {}) };
  }

  if (schema instanceof z.ZodUnion) {
    return { anyOf: (schema.options as z.ZodTypeAny[]).map(convert), ...(description ? { description } : {}) };
  }

  throw new Error(`Unsupported Zod construct in tool schema: ${schema._def.typeName}`);
}

function checksOf(schema: z.ZodString | z.ZodNumber): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const check of schema._def.checks as Array<Record<string, unknown>>) {
    switch (check.kind) {
      case 'min':
        out[typeof check.value === 'number' && schema instanceof z.ZodString ? 'minLength' : 'minimum'] = check.value;
        break;
      case 'max':
        out[typeof check.value === 'number' && schema instanceof z.ZodString ? 'maxLength' : 'maximum'] = check.value;
        break;
      case 'int':
        out.type = 'integer';
        break;
      case 'regex':
        out.pattern = String(check.regex);
        break;
      default:
        break;
    }
  }
  return out;
}
