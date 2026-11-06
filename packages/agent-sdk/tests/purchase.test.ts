import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BudgetExceededError, DuplicateRequestError, PaymentFailedError, PaymentUncertainError, PolicyDeniedError, SPICA, ValidationError } from '../src/index.js';
import { MockBackend } from './mock-backend.js';

const ROUTE = 'POST /api/sdk/v1/purchases';
const KEY = 'order-1234';
const backend = new MockBackend();
let spica: SPICA;

const paid = {
  serviceId: 'svc-1',
  transactionId: 'tx-1',
  price: { usd: '0.01', micros: '10000' },
  network: 'arc-testnet',
  reference: '0xabc',
  detail: null,
  data: '{"temp":28}',
  replayed: false,
};

beforeEach(async () => {
  await backend.start();
  backend.requests.length = 0;
  spica = new SPICA({ apiKey: 'spica_test', baseUrl: backend.url });
});
afterEach(() => backend.stop());

const attempt = (idempotencyKey: string = KEY) => spica.purchase({ serviceId: 'svc-1', idempotencyKey });

describe('purchase: outcomes', () => {
  it('reports settled only when the server confirms it', async () => {
    backend.respond(ROUTE, 200, { ...paid, status: 'settled', proofUrl: 'https://explorer.testnet.arc.io/tx/0xabc' });
    expect(await attempt()).toMatchObject({ status: 'settled', transactionId: 'tx-1', data: '{"temp":28}', idempotencyKey: KEY });
  });

  it('reports settling as settling, never as settled', async () => {
    backend.respond(ROUTE, 200, { ...paid, status: 'settling' });
    expect((await attempt()).status).toBe('settling');
  });

  it('reports a demo payment as simulated', async () => {
    backend.respond(ROUTE, 200, { ...paid, status: 'simulated' });
    expect((await attempt()).status).toBe('simulated');
  });

  it('reports an API that asked for no payment as free', async () => {
    backend.respond(ROUTE, 200, { status: 'free', serviceId: 'svc-1', data: 'ok', replayed: false });
    expect(await attempt()).toMatchObject({ status: 'free', data: 'ok' });
  });

  it('returns pending approval, with nothing paid', async () => {
    backend.respond(ROUTE, 202, { status: 'pending_approval', serviceId: 'svc-1', approvalId: 'ap-1', price: { usd: '0.4', micros: '400000' }, reason: 'Above your approval threshold', expiresAt: '2026-11-07T10:00:00Z', replayed: false });
    const result = await attempt();
    expect(result).toMatchObject({ status: 'pending_approval', approvalId: 'ap-1' });
    expect('transactionId' in result).toBe(false);
  });
});

describe('purchase: refusals', () => {
  it.each(['per_request_limit', 'daily_limit', 'monthly_limit'])('throws BudgetExceededError for %s', async (code) => {
    backend.respond(ROUTE, 403, { error: 'Over budget.', code });
    await expect(attempt()).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(attempt()).rejects.toMatchObject({ code, idempotencyKey: KEY });
  });

  it('treats a budget refusal as a policy refusal too', async () => {
    backend.respond(ROUTE, 403, { error: 'Over budget.', code: 'daily_limit' });
    await expect(attempt()).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it('throws PolicyDeniedError for a blocked provider', async () => {
    backend.respond(ROUTE, 403, { error: 'Blocked.', code: 'provider_blocked' });
    await expect(attempt()).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it('throws DuplicateRequestError while a key is in use', async () => {
    backend.respond(ROUTE, 409, { error: 'In progress.', code: 'duplicate_request' });
    await expect(attempt()).rejects.toBeInstanceOf(DuplicateRequestError);
  });

  it('throws DuplicateRequestError when a key is reused for another service', async () => {
    backend.respond(ROUTE, 409, { error: 'Different service.', code: 'idempotency_conflict' });
    await expect(attempt()).rejects.toBeInstanceOf(DuplicateRequestError);
  });
});

describe('purchase: failed and unknown payments', () => {
  it('throws PaymentFailedError for a confirmed failure', async () => {
    backend.respond(ROUTE, 200, { ...paid, status: 'failed', error: 'The seller rejected the payment.' });
    await expect(attempt()).rejects.toMatchObject({ name: 'PaymentFailedError', transactionId: 'tx-1', idempotencyKey: KEY });
    await expect(attempt()).rejects.toBeInstanceOf(PaymentFailedError);
  });

  it('throws PaymentUncertainError when the server cannot confirm', async () => {
    backend.respond(ROUTE, 200, { ...paid, status: 'uncertain', error: 'No matching transfer.' });
    await expect(attempt()).rejects.toBeInstanceOf(PaymentUncertainError);
  });

  it('never treats a dropped connection as a failure, because money may have moved', async () => {
    backend.hangUp(ROUTE);
    await expect(attempt()).rejects.toMatchObject({ name: 'PaymentUncertainError', code: 'connection_lost', idempotencyKey: KEY });
  });

  it('treats a timeout as unknown', async () => {
    const hurried = new SPICA({ apiKey: 'spica_test', baseUrl: backend.url, purchaseTimeoutMs: 1 });
    backend.respondText(ROUTE, 200, '');
    const slow = hurried.purchase({ serviceId: 'svc-1', idempotencyKey: KEY });
    await expect(slow).rejects.toBeInstanceOf(PaymentUncertainError);
  });

  it('treats a server error as unknown', async () => {
    backend.respond(ROUTE, 500, { error: 'Boom.' });
    await expect(attempt()).rejects.toMatchObject({ name: 'PaymentUncertainError', code: 'server_error' });
  });

  it('never reports success from an answer it cannot read', async () => {
    backend.respondText(ROUTE, 200, '<html>ok</html>');
    await expect(attempt()).rejects.toMatchObject({ code: 'unreadable_response' });
    backend.respond(ROUTE, 200, { status: 'paid' });
    await expect(attempt()).rejects.toBeInstanceOf(PaymentUncertainError);
  });

  it.each([
    ['a dropped connection', () => backend.hangUp(ROUTE)],
    ['a server error', () => backend.respond(ROUTE, 503, {})],
    ['a failed payment', () => backend.respond(ROUTE, 200, { status: 'failed' })],
    ['an unknown outcome', () => backend.respond(ROUTE, 200, { status: 'uncertain' })],
  ])('sends exactly one request after %s', async (_name, arrange) => {
    arrange();
    await attempt().catch(() => {});
    expect(backend.countOf(ROUTE)).toBe(1);
  });
});

describe('purchase: idempotency', () => {
  beforeEach(() => backend.respond(ROUTE, 200, { ...paid, status: 'settled', proofUrl: null }));

  it('always sends a key, generating one if needed, and returns it', async () => {
    const result = await spica.purchase({ serviceId: 'svc-1' });
    const sent = (backend.requests[0]?.body as { idempotencyKey: string }).idempotencyKey;
    expect(sent).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.idempotencyKey).toBe(sent);
  });

  it('puts a generated key on errors, so the outcome can be checked', async () => {
    backend.hangUp(ROUTE);
    const error = (await spica.purchase({ serviceId: 'svc-1' }).catch((cause) => cause)) as PaymentUncertainError;
    expect(error.idempotencyKey).toBe((backend.requests[0]?.body as { idempotencyKey: string }).idempotencyKey);
  });

  it('sends a repeated key unchanged, and shows a replay', async () => {
    backend.respond(ROUTE, 200, { ...paid, status: 'settled', proofUrl: null, data: null, replayed: true });
    expect((await attempt()).replayed).toBe(true);
    await attempt();
    const keys = backend.requests.map((request) => (request.body as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys)).toEqual(new Set([KEY]));
  });

  it('sends the service, network and params, and never a price or recipient', async () => {
    await spica.purchase({ serviceId: 'svc-1', idempotencyKey: KEY, params: { city: 'Pune' } });
    expect(backend.requests[0]?.body).toEqual({ serviceId: 'svc-1', idempotencyKey: KEY, network: 'arc-testnet', params: { city: 'Pune' } });
    expect(backend.requests[0]?.authorization).toBe('Bearer spica_test');
  });

  it('rejects a bad key or service before calling the server', async () => {
    await expect(attempt('short')).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt('has spaces in it')).rejects.toBeInstanceOf(ValidationError);
    await expect(spica.purchase({ serviceId: ' ' })).rejects.toBeInstanceOf(ValidationError);
    expect(backend.requests).toHaveLength(0);
  });
});
