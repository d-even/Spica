import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export type KeyPlacement = 'bearer' | 'header' | 'query';

/** How SPICA authenticates to a provider's API. The key inside is encrypted. */
export interface ServiceCredential {
  sealedKey: string;
  placement: KeyPlacement;
  /** Header or query parameter name. Null for bearer. */
  name: string | null;
}

const VERSION = 'v1';

const encryptionKey = () => {
  const raw = process.env.PAYGATE_ENCRYPTION_KEY ?? '';
  return /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : null;
};

export const secretsConfigured = () => encryptionKey() !== null;

const requireKey = () => {
  const key = encryptionKey();
  if (!key) throw new Error('PAYGATE_ENCRYPTION_KEY must be 64 hex characters.');
  return key;
};

/**
 * A fingerprint that identifies a key without revealing it. Keyed, so a short
 * provider key cannot be guessed from a leaked database. One-way: it can never
 * be used to call the provider, which is why `sealSecret` exists as well.
 */
export const hashSecret = (secret: string) => createHmac('sha256', requireKey()).update(secret).digest('hex');

/** AES-256-GCM. A changed or corrupted value fails to open rather than decrypting to garbage. */
export function sealSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', requireKey(), iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function openSecret(sealed: string) {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !body) throw new Error('This stored key has an unknown format.');
  const decipher = createDecipheriv('aes-256-gcm', requireKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

/** Adds a provider's key to one upstream call. Query parameters from a buyer cannot replace it. */
export function applyCredential(url: URL, headers: Record<string, string>, credential: ServiceCredential) {
  const key = openSecret(credential.sealedKey);
  if (credential.placement === 'bearer') headers.authorization = `Bearer ${key}`;
  else if (credential.placement === 'header') headers[credential.name!] = key;
  else url.searchParams.set(credential.name!, key);
}
