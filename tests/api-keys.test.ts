import { beforeAll, describe, expect, it } from 'vitest';
import { issueApiKey, readApiKey } from '@/server/api-keys';
import { seal, unseal } from '@/server/session';

const secret = 'test-secret-that-is-at-least-32-characters';
const grant = { userId: 'user', agentId: 'agent', serviceId: 'cricket-live', taskId: 'task', budgetMicros: '50000' };

describe('developer API keys', () => {
  beforeAll(() => {
    process.env.PAYGATE_SESSION_SECRET = secret;
  });

  it('round-trips the grant', () => {
    expect(readApiKey(issueApiKey(grant)!)).toEqual(grant);
  });

  it('refuses a key whose budget or service was edited', () => {
    const key = issueApiKey(grant)!;
    const [body, signature] = key.slice(3).split('.');
    const value = JSON.parse(Buffer.from(body, 'base64url').toString());
    const edited = Buffer.from(JSON.stringify({ ...value, grant: { ...grant, budgetMicros: '999999999' } })).toString('base64url');
    expect(readApiKey(`pg_${edited}.${signature}`)).toBeNull();
  });

  it('expires', () => {
    const issued = Date.now();
    const key = issueApiKey(grant, issued)!;
    expect(readApiKey(key, issued + 31 * 24 * 60 * 60_000)).toBeNull();
  });

  it('keeps sessions and keys apart, so neither stands in for the other', () => {
    const session = seal('session', { grant }, 60);
    expect(readApiKey(`pg_${session}`)).toBeNull();
    expect(unseal('session', issueApiKey(grant)!.slice(3))).toBeNull();
  });

  it('refuses anything else', () => {
    expect(readApiKey('not-a-key')).toBeNull();
    expect(readApiKey('pg_a.b')).toBeNull();
  });
});
