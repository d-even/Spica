import { z } from 'zod';
import { runAgent } from '@/server/agent';
import type { AgentEvent } from '@/server/agent/session';
import { authed } from '@/server/http/api';

const body = z.object({ message: z.string().trim().min(1, 'Type a request first.').max(2_000) });

/** Streams agent progress as newline-delimited JSON. */
export const POST = authed(
  async (user, request) => {
    const { message } = body.parse(await request.json());
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: AgentEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        await runAgent(user.id, message, emit);
        controller.close();
      },
    });
    return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
  },
  { requests: 10, windowMs: 60_000 },
);
