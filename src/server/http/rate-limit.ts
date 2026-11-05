const windows = new Map<string, number[]>();

/**
 * Sliding-window limiter. It lives in process memory, so each server instance
 * counts separately. Spending safety does not rely on it: budgets are enforced
 * in the store. Use a shared limiter if you deploy several instances.
 */
export function allowRequest(key: string, limit: number, windowMs: number, now = Date.now()) {
  const recent = (windows.get(key) ?? []).filter((time) => now - time < windowMs);
  const allowed = recent.length < limit;
  if (allowed) recent.push(now);
  windows.set(key, recent);
  return allowed;
}
