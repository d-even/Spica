'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NetworkId } from '@/lib/networks';

export const SIGN_IN_REQUIRED = 'Sign in to continue.';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong.');
  return body as T;
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(undefined);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [path]);

  useEffect(() => {
    let active = true;
    if (path) {
      api<T>(path)
        .then((value) => {
          if (active) {
            setData(value);
            setError(undefined);
          }
        })
        .catch((cause: Error) => {
          if (active) setError(cause.message);
        });
    }
    return () => {
      active = false;
    };
  }, [path]);

  return { data, error, reload };
}

/** Money fields arrive as strings of micro-USD. */
export interface PolicyDto {
  perRequestLimitMicros: string;
  dailyLimitMicros: string;
  monthlyLimitMicros: string;
  approvalThresholdMicros: string;
  autoPayEnabled: boolean;
  allowedNetworks: NetworkId[];
  allowedProviders: string[];
  blockedProviders: string[];
}

export interface TransactionDto {
  id: string;
  agentId: string;
  providerName: string;
  providerKey: string;
  providerEns: string | null;
  serviceName: string;
  resource: string;
  amountMicros: string;
  token: string;
  network: NetworkId;
  reference: string | null;
  payer: string | null;
  payTo: string;
  status: string;
  statusDetail: string | null;
  createdAt: string;
}

export interface ApprovalDto {
  id: string;
  serviceName: string;
  providerName: string;
  amountMicros: string;
  network: NetworkId;
  reason: string;
  expiresAt: string;
}

export interface IntegrationDto {
  id: string;
  label: string;
  purpose: string;
  configured: boolean;
  missing: string[];
  optional?: boolean;
}

export interface OverviewDto {
  user: { email: string; demo: boolean };
  mode: 'demo' | 'live';
  mainnetEnabled: boolean;
  store: 'memory' | 'supabase';
  networks: NetworkId[];
  integrations: IntegrationDto[];
  policy: PolicyDto;
  spend: { spentTodayMicros: string; spentThisMonthMicros: string };
  approvals: ApprovalDto[];
  transactions: TransactionDto[];
  activity: { id: string; eventType: string; eventData: Record<string, unknown>; createdAt: string }[];
}

export interface ReputationDto {
  status: 'not_enough_data' | 'scored';
  score: number | null;
  sampleSize: number;
  components: { key: string; label: string; score: number | null; detail: string }[];
}
