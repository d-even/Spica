import { integrations, mainnetEnabled, mode, activeNetworks } from '@/server/env';
import { authed, toJson } from '@/server/http/api';
import { getStore } from '@/server/store';

/** Everything the dashboard shows. Spend totals are computed here, never sent by the client. */
export const GET = authed(async (user) => {
  const store = getStore();
  const [policy, spend, approvals, transactions, activity] = await Promise.all([
    store.getPolicy(user.id),
    store.getSpendState(user.id, ''),
    store.listPendingApprovals(user.id),
    store.listTransactions(user.id, 30),
    store.listActivity(user.id, 15),
  ]);
  return toJson({
    user: { email: user.email, demo: user.demo },
    mode: mode(),
    mainnetEnabled: mainnetEnabled(),
    store: store.kind,
    networks: activeNetworks(),
    integrations: integrations(),
    policy,
    spend,
    approvals,
    transactions,
    activity,
  });
});
