import { apiError, authed, toJson } from '@/server/http/api';
import { getStore } from '@/server/store';

/** Only the owning provider can remove a service. */
export const DELETE = authed(async (user, _request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const store = getStore();
  const provider = await store.getProviderByOwner(user.id);
  if (!provider || !(await store.deleteService(provider.id, id))) return apiError('Service not found.', 404);
  return toJson({ deleted: true });
});
