import 'server-only';
import { encodeUsageCode, USAGE_CODE_HEADER } from '@/lib/usage-code';
import { assertPublicUrl, safeFetch, type FetchedResponse } from '@/server/http/guard';
import { applyCredential, openSecret, type ServiceCredential } from '@/server/secrets';

/** What a person or agent is told. Built only from the status and the listed host, never the provider's words. */
export function explainProviderStatus(host: string, status: number): string {
  if (status === 401 || status === 402 || status === 403) {
    return `${host} rejected the API key on this listing (HTTP ${status}). The provider needs to update the key or how it is sent.`;
  }
  if (status === 404 || status === 405 || status === 410) {
    return `${host} has no API at the URL on this listing (HTTP ${status}). The provider needs to correct the endpoint.`;
  }
  if (status === 429) return `${host} is rate limiting this API (HTTP 429). Try again in a minute.`;
  if (status >= 500) return `${host} had a server error (HTTP ${status}). This is usually temporary.`;
  if (status >= 300 && status < 400) {
    return `${host} redirected the request (HTTP ${status}), and SPICA does not follow redirects. The provider needs to list the final URL.`;
  }
  return `${host} refused the request (HTTP ${status}). The listing's URL or API key settings may be wrong, or the request needs different parameters.`;
}

export function explainProviderOutage(host: string, error: unknown): string {
  return (error as Error)?.name === 'TimeoutError'
    ? `${host} did not answer in time. This is usually temporary.`
    : `SPICA could not complete the call to ${host}.`;
}

/** For server logs. Removes the key, and anything else shaped like a credential. */
export function scrubProviderText(text: string, key: string | null): string {
  const withoutKey = key ? text.split(key).join('<key>') : text;
  return withoutKey.replace(/[A-Za-z0-9_\-.]{24,}/g, '<redacted>').replace(/\s+/g, ' ').slice(0, 200);
}

/** The explanation in a failure this server produced. Null if the body is anything else. */
export function readProviderFailure(body: string): string | null {
  try {
    const { error } = JSON.parse(body) as { error?: unknown };
    return typeof error === 'string' && error ? error : null;
  } catch {
    return null;
  }
}

/** Not a 2xx, so withPayment skips settlement. A status that cannot carry a body becomes 502. */
const failure = (status: number, message: string) => Response.json({ error: message }, { status: status >= 400 ? status : 502 });

/**
 * Calls the provider's real API. This runs before settlement, so every failure
 * here charges nobody. The provider's reply is not passed on when it fails: it
 * can echo the key, and an agent would read it as an instruction it can trust.
 */
export async function deliverFromProvider(
  upstream: string,
  usageCode: string | null,
  credential: ServiceCredential | null,
  query: URLSearchParams,
): Promise<Response> {
  const host = new URL(upstream).hostname;
  const key = credential ? openSecret(credential.sealedKey) : null;
  const headers: Record<string, string> = { accept: 'application/json' };

  let url: URL;
  let response: FetchedResponse;
  try {
    url = await assertPublicUrl(upstream);
    for (const [name, value] of query) url.searchParams.set(name, value);
    // Added last, and redirects stay off in safeFetch, so the key reaches only this URL.
    if (credential) applyCredential(url, headers, credential);
    response = await safeFetch(url, { headers });
  } catch (error) {
    console.error(`[provider] Call to ${host} failed: ${scrubProviderText((error as Error).message, key)}`);
    return failure(502, explainProviderOutage(host, error));
  }

  if (response.status < 200 || response.status >= 300) {
    console.error(`[provider] ${host}${url.pathname} returned HTTP ${response.status}: ${scrubProviderText(response.text, key)}`);
    return failure(response.status, explainProviderStatus(host, response.status));
  }

  // withPayment returns this only after settlement, so the code is never released unpaid.
  return new Response(response.text, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json',
      ...(usageCode ? { [USAGE_CODE_HEADER]: encodeUsageCode(usageCode) } : {}),
    },
  });
}
