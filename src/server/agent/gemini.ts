import 'server-only';
import { z } from 'zod';
import { generateWithFallback } from './fallback';
import type { AgentSession } from './session';
import { agentTools, runTool, SYSTEM_PROMPT, type AgentTool } from './tools';

/**
 * Gemini planner over the Gemini API's REST interface (no SDK needed).
 * Models are tried in order, so one model's outage or spent quota does not end
 * a run that may already have paid. Set GEMINI_MODEL to use only that one.
 */
const MODELS = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
export const geminiModels = () => (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : MODELS);
export const geminiModel = () => geminiModels()[0];
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_STEPS = 10;
/** An overloaded model can hang without answering, so give up and try the next. */
const TIMEOUT_MS = 30_000;

export class GeminiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}
interface Content {
  role: 'user' | 'model';
  parts: Part[];
}
interface GenerateResponse {
  candidates?: { content?: Content; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/** Gemini takes an OpenAPI-style subset of JSON Schema: drop keywords it rejects. */
export function toGeminiSchema(schema: z.ZodObject): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$schema' || key === 'additionalProperties') continue;
      out[key] = strip(value);
    }
    return out;
  };
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}

const declarations = (tools: AgentTool[]) =>
  tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.inputSchema) }));

async function generate(model: string, contents: Content[], tools: AgentTool[]): Promise<GenerateResponse> {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      tools: [{ functionDeclarations: declarations(tools) }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GeminiError(response.status, body.error?.message ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as GenerateResponse;
}

const asObject = (text: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { result: value };
  } catch {
    return { result: text };
  }
};

export async function runGeminiAgent(session: AgentSession, message: string) {
  const tools = agentTools(session);
  const contents: Content[] = [{ role: 'user', parts: [{ text: message }] }];
  let models = geminiModels();

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const attempt = await generateWithFallback(models, (model) => generate(model, contents, tools));
    const { result } = attempt;
    models = attempt.models;
    const candidate = result.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
      const reason = result.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'no reply';
      session.emit({ type: 'error', message: `Gemini did not answer (${reason}).` });
      return;
    }

    const calls = candidate.content.parts.filter((part) => part.functionCall);
    if (calls.length === 0) {
      const text = candidate.content.parts
        .filter((part) => part.text && !part.thought)
        .map((part) => part.text)
        .join('\n')
        .trim();
      session.emit({ type: 'answer', text: text || 'Done.', source: 'gemini' });
      return;
    }

    // Send the model turn back unchanged: newer models require their thought signatures.
    contents.push({ role: 'model', parts: candidate.content.parts });
    const responses: Part[] = [];
    for (const { functionCall } of calls) {
      const output = await runTool(tools, functionCall!.name, functionCall!.args);
      responses.push({
        functionResponse: {
          ...(functionCall!.id ? { id: functionCall!.id } : {}),
          name: functionCall!.name,
          response: asObject(output),
        },
      });
    }
    contents.push({ role: 'user', parts: responses });
  }
  session.emit({ type: 'error', message: 'The agent stopped after too many steps without an answer.' });
}
