/**
 * Proves the tests can fail: breaks each protection in turn and expects the
 * suite to go red. Every file is restored afterward.
 *   node scripts/mutation-check.mjs
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const MUTATIONS = [
  ['per-request limit removed', 'src/server/firewall/policy.ts', 'if (amount > policy.perRequestLimitMicros) {', 'if (false) {'],
  ['task budget check removed', 'src/server/firewall/policy.ts', "    request.taskBudgetMicros !== undefined &&\n    spend.spentThisTaskMicros + amount > request.taskBudgetMicros", '    false'],
  ['approval waives hard limits', 'src/server/firewall/policy.ts', "const { amountMicros: amount, network: networkId, providerKey } = request;", "const { amountMicros: amount, network: networkId, providerKey } = request;\n  if (options.humanApproved) return { outcome: 'allow', reason: 'x' };"],
  ['blocklist ignored', 'src/server/firewall/policy.ts', 'if (policy.blockedProviders.includes(providerKey)) {', 'if (false) {'],
  ['any asset accepted', 'src/server/firewall/policy.ts', 'if (!network || request.asset.toLowerCase() !== network.tokenAsset.toLowerCase()) {', 'if (!network) {'],
  ['price rise accepted', 'src/server/firewall/policy.ts', 'amount > request.listedAmountMicros', 'false'],
  ['Identity mismatch ignored', 'src/server/firewall/policy.ts', "if (request.identityStatus === 'mismatch') {", 'if (false) {'],
  ['reservation skips daily budget', 'src/server/store/memory.ts', "if (state.spentTodayMicros + input.amountMicros > input.dailyLimitMicros) return { ok: false, reason: 'daily_limit' };", ''],
  ['reservation skips task budget', 'src/server/store/memory.ts', 'if (input.taskBudgetMicros !== undefined && state.spentThisTaskMicros + input.amountMicros > input.taskBudgetMicros) {', 'if (false) {'],
  ['duplicates allowed', 'src/server/store/memory.ts', "return { ok: false, reason: 'duplicate' };", ''],
  ['signing gate reusable', 'src/server/store/memory.ts', "if (!reservation || reservation.status !== 'held' || reservation.requirementHash !== requirementHash) return false;", 'if (!reservation) return false;'],
  ['unknown outcome released', 'src/server/store/memory.ts', "if (reservation.status === 'signing' && !options?.paymentNotSent) return;", ''],
  ['approval decided by anyone', 'src/server/store/memory.ts', "if (!approval || approval.userId !== userId || approval.status !== 'pending') return null;", "if (!approval || approval.status !== 'pending') return null;"],
  ['replay guard skipped', 'spica/src/index.ts', "if (!(await options.replayGuard.claim(id))) return reject('duplicate_payment', offered.network);", ''],
  ['requirement match skipped', 'spica/src/index.ts', 'const offered = accepts.find((requirement) => requirementsMatch(requirement, payload.accepted));', 'const offered = accepts[0];'],
  ['invalid proof accepted', 'spica/src/index.ts', 'if (!verification.isValid) {', 'if (false) {'],
  ['failed settlement delivers data', 'spica/src/index.ts', 'if (!settlement.success) {', 'if (false) {'],
  ['charged when handler fails', 'spica/src/index.ts', 'if (!upstream.ok) {', 'if (false) {'],
  ['reputation invents a score', 'src/server/reputation.ts', "if (total < MIN_OBSERVATIONS) return { status: 'not_enough_data', score: null, sampleSize: total, components };", ''],
];

let survived = 0;
for (const [name, file, from, to] of MUTATIONS) {
  const original = fs.readFileSync(file, 'utf8');
  // Git may check files out with CRLF on Windows, which multi-line patterns must follow.
  const pattern = original.includes('\r\n') ? from.replaceAll('\n', '\r\n') : from;
  if (!original.includes(pattern)) {
    console.log(`STALE     ${name}: pattern not found`);
    survived += 1;
    continue;
  }
  fs.writeFileSync(file, original.replace(pattern, to));
  try {
    const run = spawnSync('npx', ['vitest', 'run'], { encoding: 'utf8', shell: true });
    const caught = run.status !== 0;
    console.log(`${caught ? 'CAUGHT  ' : 'SURVIVED'}  ${name}`);
    if (!caught) survived += 1;
  } finally {
    fs.writeFileSync(file, original);
  }
}
console.log(survived ? `\n${survived} mutation(s) not caught` : `\nAll ${MUTATIONS.length} mutations caught`);
process.exit(survived ? 1 : 0);
