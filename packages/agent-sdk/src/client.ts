import { compare } from './comparison.js';
import { discover, inspect } from './discovery.js';
import { AuthenticationError, ConnectionError, ValidationError, errorFromResponse, type ErrorBody } from './errors.js';
import { history } from './history.js';
import { getBudget } from './policies.js';
import { purchase } from './purchases.js';
import { quote } from './quotes.js';
import type {
  Budget,
  Comparison,
  DiscoverOptions,
  HistoryOptions,
  HistoryPage,
  Network,
  PurchaseOptions,
  PurchaseResult,
  Quote,
  Service,
  ServiceDetails,
  SpicaOptions,
} from './types.js';

const READ_TIMEOUT_MS = 30_000;
const PURCHASE_TIMEOUT_MS = 120_000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

interface RequestOptions {
  /** Sends the agent key. Discovery and quotes are public and do not need it. */
  authenticated?: boolean;
  body?: unknown;
  timeoutMs?: number;
}

export interface RawResponse {
  status: number;
  body: unknown;
}

const environment = (name: string) => (typeof process === 'undefined' ? undefined : process.env?.[name]);

/** Refuses plain http off this machine, because the key would travel in the clear. */
function parseBaseUrl(value: string | undefined) {
  if (!value) throw new ValidationError('Set baseUrl or SPICA_BASE_URL to your SPICA server.', { code: 'missing_base_url' });
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError('baseUrl is not a valid URL.', { code: 'invalid_base_url' });
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new ValidationError('baseUrl must use https, except on localhost.', { code: 'insecure_base_url' });
  }
  return url.href.replace(/\/+$/, '');
}

/** One request, never retried: only the caller can decide a payment is safe to repeat. */
export class HttpClient {
  readonly network: Network;
  readonly purchaseTimeoutMs: number;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly send: typeof fetch;

  constructor(options: SpicaOptions) {
    this.apiKey = options.apiKey ?? environment('SPICA_API_KEY');
    this.baseUrl = parseBaseUrl(options.baseUrl ?? environment('SPICA_BASE_URL'));
    this.network = options.network ?? 'arc-testnet';
    this.timeoutMs = options.timeoutMs ?? READ_TIMEOUT_MS;
    this.purchaseTimeoutMs = options.purchaseTimeoutMs ?? PURCHASE_TIMEOUT_MS;
    this.send = options.fetch ?? globalThis.fetch;
    if (this.network !== 'arc-testnet') throw new ValidationError('The only supported network is arc-testnet.', { code: 'invalid_network' });
    if (!this.send) throw new ValidationError('This runtime has no fetch. Use Node 18 or newer, or pass one in.', { code: 'missing_fetch' });
  }

  /** Any answer from the server, whatever its status. Throws if there was no answer. */
  async raw(method: 'GET' | 'POST', path: string, options: RequestOptions = {}): Promise<RawResponse> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.authenticated) {
      if (!this.apiKey) throw new AuthenticationError('Set apiKey or SPICA_API_KEY to an agent key from Settings.', { code: 'missing_api_key' });
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    let text: string;
    try {
      response = await this.send(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
      });
      text = await response.text();
    } catch {
      // The cause can quote the request, so it stays out of the message.
      throw new ConnectionError('Could not reach SPICA.', { code: 'connection_failed' });
    }

    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  /** A JSON answer, or the matching error. */
  async json<T>(method: 'GET' | 'POST', path: string, options: RequestOptions = {}): Promise<T> {
    const { status, body } = await this.raw(method, path, options);
    if (status < 200 || status >= 300) throw errorFromResponse(status, (body ?? {}) as ErrorBody);
    return body as T;
  }
}

/**
 * Client for the SPICA backend. It holds no payment keys and makes no payment
 * decisions: every purchase goes through the server's Spending Firewall.
 *
 * @example
 * const spica = new SPICA({ apiKey: process.env.SPICA_API_KEY, baseUrl: process.env.SPICA_BASE_URL });
 * const [service] = await spica.discover({ query: 'weather', maxPrice: '0.05' });
 */
export class SPICA {
  private readonly http: HttpClient;

  constructor(options: SpicaOptions = {}) {
    this.http = new HttpClient(options);
  }

  /** Searches the marketplace, cheapest first. Needs no API key. */
  discover(options: DiscoverOptions = {}): Promise<Service[]> {
    return discover(this.http, options);
  }

  /** Reads one service, with its measured reputation. Needs no API key. */
  inspect(serviceId: string): Promise<ServiceDetails> {
    return inspect(this.http, serviceId);
  }

  /** Lines up services by ID or from `inspect`. It does not choose or pay. */
  compare(services: (string | ServiceDetails)[]): Promise<Comparison> {
    return compare(this.http, services);
  }

  /** Reads the seller's live terms. Costs nothing, and is not a promise that your limits allow it. */
  quote(options: { serviceId: string }): Promise<Quote> {
    return quote(this.http, options);
  }

  /**
   * Asks SPICA to buy one call. Check `status`: only `settled` means the money
   * moved. Refusals and failures throw, and nothing here ever retries a payment.
   *
   * @throws {BudgetExceededError} A spending limit would be exceeded.
   * @throws {PolicyDeniedError} Another spending rule refused it.
   * @throws {DuplicateRequestError} This key is already in use.
   * @throws {PaymentFailedError} The payment failed.
   * @throws {PaymentUncertainError} The outcome is unknown. Repeat with the same key.
   */
  purchase(options: PurchaseOptions): Promise<PurchaseResult> {
    return purchase(this.http, options);
  }

  /** Reads your limits and what is left. An agent key can never change them. */
  getBudget(): Promise<Budget> {
    return getBudget(this.http);
  }

  /** Lists this account's payments, newest first. */
  history(options: HistoryOptions = {}): Promise<HistoryPage> {
    return history(this.http, options);
  }
}
