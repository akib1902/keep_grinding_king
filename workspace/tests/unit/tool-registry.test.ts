/**
 * Tool registry — SRS-AGENT-001..003.
 *
 * The registry is the allow-list. These tests assert that an unregistered tool is
 * refused, that malformed arguments never reach a handler, and that the JSON Schema
 * advertised to the model is generated from — and cannot drift away from — the Zod
 * schema the runtime validates with.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, defineTool, zodToJsonSchema } from '../../src/app/tools/registry.js';
import { TOOL_NAMES, createFinancialToolRegistry } from '../../src/app/tools/financial-tools.js';

interface Ctx {
  calls: number;
}

function buildRegistry(): ToolRegistry<Ctx> {
  const registry = new ToolRegistry<Ctx>();
  registry.register(
    defineTool({
      name: 'do_read',
      description: 'Reads something.',
      effect: 'READ',
      argsSchema: z.object({
        required: z.string().min(1).describe('A required string.'),
        optionalNumber: z.number().int().min(0).max(10).default(5),
        filter: z.array(z.string()).optional(),
      }),
      resultSchema: z.object({ ok: z.boolean(), value: z.string() }),
      execute: async (args, context: Ctx) => {
        context.calls += 1;
        return { ok: true, value: `${args.required}:${args.optionalNumber}` };
      },
    }),
  );
  registry.register(
    defineTool({
      name: 'do_write',
      description: 'Writes something.',
      effect: 'WRITE',
      argsSchema: z.object({ amountMinor: z.number().int().positive() }),
      resultSchema: z.object({ accepted: z.boolean() }),
      execute: async () => ({ accepted: true }),
    }),
  );
  registry.register(
    defineTool({
      name: 'bad_result',
      description: 'Returns a result that violates its own schema.',
      effect: 'READ',
      argsSchema: z.object({}),
      resultSchema: z.object({ expected: z.string() }),
      execute: async () => ({ unexpected: 1 }) as never,
    }),
  );
  registry.register(
    defineTool({
      name: 'throwing',
      description: 'Throws.',
      effect: 'READ',
      argsSchema: z.object({}),
      resultSchema: z.object({}),
      execute: async () => {
        throw new Error('handler exploded with secret details');
      },
    }),
  );
  return registry;
}

describe('registry: allow-list', () => {
  it('refuses an unregistered tool without executing anything', async () => {
    const registry = buildRegistry();
    const response = await registry.invoke('execute_sql', { sql: 'DROP TABLE ledger_entries' }, { calls: 0 });
    expect(response).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_REGISTERED', retryable: false } });
    expect(JSON.stringify(response)).not.toMatch(/DROP TABLE/);
  });

  it('reports availability through has()', () => {
    const registry = buildRegistry();
    expect(registry.has('do_read')).toBe(true);
    expect(registry.has('execute_sql')).toBe(false);
  });

  it('refuses to register the same tool twice', () => {
    const registry = new ToolRegistry<Ctx>();
    const tool = defineTool({
      name: 'dup',
      description: 'x',
      effect: 'READ',
      argsSchema: z.object({}),
      resultSchema: z.object({}),
      execute: async () => ({}),
    });
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(/already registered/);
  });
});

describe('registry: argument validation before execution', () => {
  it('rejects malformed arguments and never runs the handler', async () => {
    const registry = buildRegistry();
    const context: Ctx = { calls: 0 };
    const response = await registry.invoke('do_read', { required: 42 }, context);
    expect(response).toMatchObject({ ok: false, error: { code: 'TOOL_ARGUMENT_INVALID' } });
    expect(context.calls).toBe(0);
  });

  it('applies schema defaults and coercion rules', async () => {
    const registry = buildRegistry();
    const context: Ctx = { calls: 0 };
    const response = await registry.invoke('do_read', { required: 'hello' }, context);
    expect(response).toEqual({ ok: true, data: { ok: true, value: 'hello:5' } });
    expect(context.calls).toBe(1);
  });

  it('rejects an otherwise valid argument set that breaks a bound', async () => {
    const registry = buildRegistry();
    const response = await registry.invoke('do_write', { amountMinor: 0 }, { calls: 0 });
    expect(response).toMatchObject({ ok: false, error: { code: 'TOOL_ARGUMENT_INVALID' } });
  });
});

describe('registry: result validation and error containment', () => {
  it('refuses a handler result that violates the declared result schema', async () => {
    const registry = buildRegistry();
    const response = await registry.invoke('bad_result', {}, { calls: 0 });
    expect(response).toMatchObject({ ok: false, error: { code: 'TOOL_EXECUTION_FAILED' } });
  });

  it('turns a thrown handler error into a controlled, non-retryable result', async () => {
    const registry = buildRegistry();
    const response = await registry.invoke('throwing', {}, { calls: 0 });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.message).not.toMatch(/secret details|exploded/);
      expect(response.error.retryable).toBe(false);
    }
  });
});

describe('registry: financial tools', () => {
  const registry = createFinancialToolRegistry();

  it('registers exactly the six documented capabilities', () => {
    expect(registry.names()).toEqual([...TOOL_NAMES].sort());
  });

  it('marks only create_refund_proposal as a write capability', () => {
    const effects = [...TOOL_NAMES].map((name) => ({ name, effect: registry.describe(name)?.effect }));
    expect(effects.filter((entry) => entry.effect === 'WRITE')).toEqual([
      { name: 'create_refund_proposal', effect: 'WRITE' },
    ]);
  });

  it('advertises a JSON Schema to the model that matches the Zod schema it validates with', () => {
    for (const name of TOOL_NAMES) {
      const described = registry.describe(name);
      expect(described).not.toBeNull();
      if (!described) continue;

      const shape = described.argsSchema instanceof z.ZodObject ? (described.argsSchema.shape as Record<string, z.ZodTypeAny>) : {};
      const declared = registry.declarations().find((declaration) => declaration.name === name);
      expect(declared).toBeDefined();
      const properties = (declared?.parameters.properties ?? {}) as Record<string, unknown>;

      // Same property names...
      expect(Object.keys(properties).sort()).toEqual(Object.keys(shape).sort());

      // ...and the same required set (optional/defaulted fields must not be required).
      const required = (declared?.parameters.required ?? []) as string[];
      const expectedRequired = Object.entries(shape)
        .filter(([, schema]) => !schema.isOptional() && !(schema instanceof z.ZodDefault))
        .map(([key]) => key)
        .sort();
      expect([...required].sort()).toEqual(expectedRequired);
    }
  });

  it('generates an object schema with additionalProperties disabled for every tool', () => {
    for (const declaration of registry.declarations()) {
      expect(declaration.parameters.type).toBe('object');
      expect(declaration.parameters.additionalProperties).toBe(false);
      expect(declaration.description.length).toBeGreaterThan(20);
    }
  });
});

describe('zodToJsonSchema', () => {
  it('converts the supported subset', () => {
    const schema = zodToJsonSchema(
      z.object({
        name: z.string().min(2).max(10),
        count: z.number().int().min(1),
        flag: z.boolean(),
        mode: z.enum(['a', 'b']),
        items: z.array(z.string()),
        note: z.string().optional(),
      }),
    );
    expect(schema).toMatchObject({
      type: 'object',
      required: ['name', 'count', 'flag', 'mode', 'items'],
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 10 },
        count: { type: 'integer', minimum: 1 },
        flag: { type: 'boolean' },
        mode: { type: 'string', enum: ['a', 'b'] },
        items: { type: 'array', items: { type: 'string' } },
      },
    });
  });

  it('throws on an unsupported construct rather than emitting a wrong schema', () => {
    const spy = vi.fn();
    expect(() => zodToJsonSchema(z.date())).toThrow(/Unsupported Zod construct/);
    expect(spy).not.toHaveBeenCalled();
  });
});
