/** Budget windows are UTC calendar days and months. */
export const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** An identical purchase inside this window is treated as a duplicate. */
export const DEDUPE_WINDOW_MS = 60_000;

/**
 * A hold that never reached signing stops counting after this long. Holds that
 * reached signing never expire: the payment may have gone out, so they stay
 * counted until reconciled.
 */
export const HOLD_TTL_MS = 5 * 60_000;

export const APPROVAL_TTL_MS = 10 * 60_000;
