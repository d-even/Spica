import { apiError, authed, toJson } from '@/server/http/api';
import { getStore } from '@/server/store';

/** Scoped to the signed-in user, so one person's receipt ID is useless to another. */
export const GET = authed(async (user, _request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const transaction = await getStore().getTransaction(user.id, id);
  return transaction ? toJson(transaction) : apiError('Receipt not found.', 404);
});
