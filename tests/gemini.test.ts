import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runGeminiAgent, toGeminiSchema } from '@/server/agent/gemini';
import { AgentSession, type AgentEvent } from '@/server/agent/session';
import { agentProvider } from '@/server/env';
import { MemoryStore } from '@/server/store/memory';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('toGeminiSchema', () => {
  it('drops JSON Schema keywords Gemini rejects and keeps the rest', () => {
    const schema = toGeminiSchema(z.object({ query: z.string().describe('term'), tier: z.enum(['a', 'b']).optional() }));
    expect(schema).not.toHaveProperty('$schema');
    expect(schema).not.toHaveProperty('additionalProperties');
    expect(schema).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string', description: 'term' }, tier: { enum: ['a', 'b'] } },
      required: ['query'],
    });
  });
});

describe('agentProvider', () => {
  it('prefers an explicit choice, then whichever key is set', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(agentProvider()).toBe('demo');
    vi.stubEnv('GEMINI_API_KEY', 'g');
    expect(agentProvider()).toBe('gemini');
    vi.stubEnv('ANTHROPIC_API_KEY', 'a');
    vi.stubEnv('AGENT_PROVIDER', 'claude');
    expect(agentProvider()).toBe('claude');
  });
});

describe('runGeminiAgent', () => {
  it('runs tool calls, echoes the model turn with its thought signature, and emits the answer', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const bodies: Record<string, unknown>[] = [];
    const replies = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'discover_services', args: { query: 'cricket' } }, thoughtSignature: 'sig-1' }],
            },
          },
        ],
      },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'thinking', thought: true }, { text: 'Two cricket feeds are available.' }] } }] },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toContain(':generateContent');
        expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(replies[bodies.length - 1]), { status: 200 });
      }),
    );

    const events: AgentEvent[] = [];
    const store = new MemoryStore();
    const session = new AgentSession(store, 'user', await store.ensureAgent('user'), undefined, undefined, (event) => events.push(event));
    await runGeminiAgent(session, 'cricket scores please');

    expect(bodies).toHaveLength(2);
    const first = bodies[0] as { tools: { functionDeclarations: { name: string }[] }[] };
    expect(first.tools[0].functionDeclarations.map((tool) => tool.name)).toEqual(['discover_services', 'inspect_service', 'purchase_service']);

    const second = bodies[1] as { contents: { role: string; parts: Record<string, unknown>[] }[] };
    expect(second.contents[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'discover_services', args: { query: 'cricket' } }, thoughtSignature: 'sig-1' }],
    });
    const reply = second.contents[2];
    expect(reply.role).toBe('user');
    const response = (reply.parts[0].functionResponse as { name: string; response: { services: unknown[] } });
    expect(response.name).toBe('discover_services');
    expect(Array.isArray(response.response.services)).toBe(true);

    expect(events.some((event) => event.type === 'discovered')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'answer', text: 'Two cricket feeds are available.', source: 'gemini' });
  });

  it('turns invalid tool arguments into a message for the model instead of throwing', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    const bodies: { contents: { parts: { functionResponse?: { response: { error?: string } } }[] }[] }[] = [];
    const replies = [
      { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'inspect_service', args: {} } }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(replies[bodies.length - 1]));
      }),
    );
    const store = new MemoryStore();
    const session = new AgentSession(store, 'u', await store.ensureAgent('u'), undefined, undefined, () => {});
    await runGeminiAgent(session, 'x');
    expect(bodies[1].contents[2].parts[0].functionResponse?.response.error).toMatch(/Invalid arguments/);
  });
});
