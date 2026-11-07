import type { HttpClient } from './client.js';
import type { Budget } from './types.js';

/** Read-only by design. There is no method here, or route, that lets an agent change a limit. */
export function getBudget(http: HttpClient): Promise<Budget> {
  return http.json<Budget>('GET', '/api/sdk/v1/budget', { authenticated: true });
}
