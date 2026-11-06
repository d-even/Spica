import { issueAgentKey } from '@/server/api-keys';
import { apiError, authed, toJson } from '@/server/http/api';
import { getStore } from '@/server/store';

/** A signed-in person creates a key for their agent. An agent key cannot reach this route. */
export const POST = authed(
  async (user) => {
    const agentId = await getStore().ensureAgent(user.id);
    const issued = issueAgentKey({ userId: user.id, agentId });
    return issued ? toJson(issued) : apiError('Agent keys are not configured on this server.', 503);
  },
  { requests: 5, windowMs: 60_000 },
);
