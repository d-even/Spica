import { toJson } from '@/server/http/api';
import { agentRoute, budgetFor } from '@/server/sdk';
import { getStore } from '@/server/store';

/** Read-only. No route accepts an agent key for changing a limit. */
export const GET = agentRoute(async (grant) => toJson(await budgetFor(getStore(), grant)));
