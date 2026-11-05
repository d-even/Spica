/**
 * End-to-end check against a running server in demo mode.
 *   PAYGATE_PUBLIC_URL=http://localhost:3100 npx next start -p 3100
 *   node scripts/e2e-demo.mjs http://localhost:3100
 * No keys needed. No money moves. State accumulates, so restart the server between runs.
 */
const base = process.argv[2] ?? 'http://localhost:3000';
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

const json = async (path, init) => {
  const response = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json' } });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
};

async function agent(message) {
  const response = await fetch(`${base}/api/agent/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const text = await response.text();
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const setPolicy = (change) =>
  json('/api/policy', {
    method: 'PUT',
    body: JSON.stringify({
      perRequestLimit: '0.50',
      dailyLimit: '1.00',
      monthlyLimit: '10.00',
      approvalThreshold: '0.20',
      autoPayEnabled: true,
      allowedNetworks: ['arc-testnet', 'hedera-testnet'],
      allowedProviders: [],
      blockedProviders: [],
      ...change,
    }),
  });

// x402 seller
const unpaid = await fetch(`${base}/api/x402/cricket-live`);
check('unpaid request gets HTTP 402', unpaid.status === 402, `status ${unpaid.status}`);
check('402 carries PAYMENT-REQUIRED', Boolean(unpaid.headers.get('payment-required')));
const unpaidBody = await unpaid.json();
check('402 quotes $0.02 in x402 v2', unpaidBody.x402Version === 2 && unpaidBody.accepts?.[0]?.amount === '20000');
check('402 leaks no data', unpaidBody.matches === undefined && unpaidBody.sample === undefined);

const forged = Buffer.from(
  JSON.stringify({ x402Version: 2, accepted: unpaidBody.accepts[0], payload: { signature: 'forged' }, resource: unpaidBody.resource }),
).toString('base64');
const invalid = await fetch(`${base}/api/x402/cricket-live`, { headers: { 'PAYMENT-SIGNATURE': forged } });
check('forged proof is rejected', invalid.status === 402, (await invalid.json()).error);

const underpaid = Buffer.from(
  JSON.stringify({ x402Version: 2, accepted: { ...unpaidBody.accepts[0], amount: '1' }, payload: { signature: 'x' }, resource: unpaidBody.resource }),
).toString('base64');
const under = await fetch(`${base}/api/x402/cricket-live`, { headers: { 'PAYMENT-SIGNATURE': underpaid } });
check('underpaying proof is rejected', under.status === 402, (await under.json()).error);

const garbage = await fetch(`${base}/api/x402/cricket-live`, { headers: { 'PAYMENT-SIGNATURE': '!!!' } });
check('garbage proof is rejected', garbage.status === 402);

const missing = await fetch(`${base}/api/x402/does-not-exist`);
check('unknown service gets 404', missing.status === 404);

// The headline journey
await setPolicy({});
const journey = await agent("Find today's cricket scores and provide the latest updates. My spending budget is $0.05.");
const types = journey.map((event) => event.type);
check('server read the $0.05 budget', journey.find((e) => e.type === 'budget')?.amount === '$0.05');
check('agent discovered services', types.includes('discovered'));
check('agent chose the $0.02 service', journey.find((e) => e.type === 'selected')?.service.id === 'cricket-live');
check('firewall approved it', journey.find((e) => e.type === 'policy')?.decision === 'allow');
const receipt = journey.find((e) => e.type === 'receipt')?.transaction;
check('receipt issued', Boolean(receipt));
check('demo receipt is labelled simulated, never verified', receipt?.status === 'simulated', receipt?.status);
check('sample data is labelled as sample', journey.find((e) => e.type === 'data')?.data.includes('"sample":true'));
check('agent answered', Boolean(journey.find((e) => e.type === 'answer')));

const stored = await json(`/api/transactions/${receipt.id}`);
check('receipt is retrievable', stored.status === 200 && stored.body.amountMicros === '20000');
for (const field of ['id', 'agentId', 'serviceName', 'amountMicros', 'token', 'network', 'reference', 'createdAt', 'status']) {
  check(`receipt has ${field}`, stored.body[field] !== undefined && stored.body[field] !== null);
}

const overview = await json('/api/overview');
check('dashboard spend updated from the ledger', overview.body.spend.spentTodayMicros === '20000', overview.body.spend.spentTodayMicros);

// Replay: same requirement inside the dedupe window
const duplicate = await agent('Find cricket scores. My budget is $0.05.');
check('identical repeat purchase is stopped', JSON.stringify(duplicate).includes('identical purchase'));

// $2.00 service: only cricket-pro remains, so block expensive by budget
const expensive = await agent('Get cricket pro feed scores, budget $0.01');
const denials = expensive.filter((e) => e.type === 'policy' && e.decision === 'deny').map((e) => e.reason);
check('task budget blocks both services', denials.length >= 1, denials.join(' | '));
check('no payment was signed', !expensive.some((e) => e.type === 'payment'));

// Blocked provider
await setPolicy({ blockedProviders: ['paygate:builtin'] });
const blocked = await agent('Get cricket scores.');
check('blocked provider is refused', blocked.some((e) => e.type === 'policy' && e.reason.includes('blocklist')));
check('blocked provider gets no payment', !blocked.some((e) => e.type === 'payment'));

// Approval
await setPolicy({ approvalThreshold: '0.01', dailyLimit: '5.00' });
await new Promise((resolve) => setTimeout(resolve, 61_000));
const needsApproval = await agent('Get cricket scores.');
const request = needsApproval.find((e) => e.type === 'approval_required');
check('payment above the threshold waits for a person', Boolean(request), request?.reason);
check('nothing was signed before approval', !needsApproval.some((e) => e.type === 'payment'));
const approved = await json(`/api/approvals/${request.approvalId}`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) });
check('approval completes the payment', approved.body.outcome === 'delivered', approved.body.outcome);
const again = await json(`/api/approvals/${request.approvalId}`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) });
check('an approval cannot be reused', again.status === 409);

// Rejected approval
await new Promise((resolve) => setTimeout(resolve, 61_000));
const second = (await agent('Get cricket scores.')).find((e) => e.type === 'approval_required');
const before = (await json('/api/overview')).body.spend.spentTodayMicros;
const declined = await json(`/api/approvals/${second.approvalId}`, { method: 'POST', body: JSON.stringify({ decision: 'rejected' }) });
const after = (await json('/api/overview')).body.spend.spentTodayMicros;
check('declining stops the payment', declined.body.outcome === 'rejected' && before === after);

// Input validation
const bad = await setPolicy({ dailyLimit: 'lots' });
check('invalid policy is rejected', bad.status === 400, bad.body?.error);
const inverted = await setPolicy({ dailyLimit: '20.00', monthlyLimit: '10.00' });
check('inconsistent limits are rejected', inverted.status === 400, inverted.body?.error);
const noBody = await json('/api/agent/run', { method: 'POST', body: JSON.stringify({ message: '' }) });
check('empty agent message is rejected', noBody.status === 400);
const client = await json('/api/overview?spentTodayMicros=0');
check('client cannot influence spend totals', client.body.spend.spentTodayMicros !== '0');

// Live public discovery
const market = await json('/api/marketplace?query=weather');
check('marketplace serves real catalog data', market.status === 200 && market.body.total > 0, `${market.body.total} results`);
check('unmeasured services say Not enough data', market.body.services.at(-1).reputation.status === 'not_enough_data');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
