import 'server-only';
import { connection, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { currentUser, type SessionUser } from '@/server/auth';
import { allowRequest } from './rate-limit';

/** BigInt money fields become strings on the wire. */
export const toJson = (value: unknown) =>
  NextResponse.json(JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item))));

export const apiError = (message: string, status: number) => NextResponse.json({ error: message }, { status });

/** For public, read-only routes: rate limits per client and maps failures to safe responses. */
export function open<Args extends unknown[]>(handler: (request: Request, ...args: Args) => Promise<Response>) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    await connection();
    try {
      const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
      if (!allowRequest(`open:${client}:${new URL(request.url).pathname}`, 120, 60_000)) return apiError('Too many requests. Try again shortly.', 429);
      return await handler(request, ...args);
    } catch (error) {
      if (error instanceof ZodError) return apiError(error.issues[0]?.message ?? 'Invalid request.', 400);
      console.error('API error:', error);
      return apiError('Something went wrong on our side.', 500);
    }
  };
}

/** Authenticates, rate limits per user, and maps failures to safe responses. */
export function authed<Args extends unknown[]>(
  handler: (user: SessionUser, request: Request, ...args: Args) => Promise<Response>,
  limit: { requests: number; windowMs: number } = { requests: 120, windowMs: 60_000 },
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    // Outside the try: this signals Next.js that the route is per-request.
    await connection();
    try {
      const user = await currentUser();
      if (!user) return apiError('Sign in to continue.', 401);
      const key = `${user.id}:${new URL(request.url).pathname}:${request.method}`;
      if (!allowRequest(key, limit.requests, limit.windowMs)) return apiError('Too many requests. Try again shortly.', 429);
      return await handler(user, request, ...args);
    } catch (error) {
      if (error instanceof ZodError) return apiError(error.issues[0]?.message ?? 'Invalid request.', 400);
      console.error('API error:', error);
      return apiError('Something went wrong on our side.', 500);
    }
  };
}
