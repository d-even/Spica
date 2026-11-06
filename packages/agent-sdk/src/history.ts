import type { HttpClient } from './client.js';
import { ValidationError } from './errors.js';
import type { HistoryOptions, HistoryPage } from './types.js';

export async function history(http: HttpClient, { limit, cursor }: HistoryOptions): Promise<HistoryPage> {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    throw new ValidationError('limit must be a whole number from 1 to 100.', { code: 'invalid_limit' });
  }
  const search = new URLSearchParams();
  if (limit) search.set('limit', String(limit));
  if (cursor) search.set('cursor', cursor);
  const query = search.toString() ? `?${search}` : '';
  return http.json<HistoryPage>('GET', `/api/sdk/v1/history${query}`, { authenticated: true });
}
