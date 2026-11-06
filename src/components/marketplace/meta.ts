import { Bot, Boxes, CloudSun, Code2, Database, Landmark, Newspaper, Palette, Search, Server, Shapes, TrendingUp, Trophy, Users, type LucideIcon } from 'lucide-react';
import type { ReputationDto } from '@/components/api';
import type { CatalogService } from '@/server/discovery/types';

export type Service = CatalogService & { reputation: ReputationDto };

export interface CategoryMeta {
  value: string;
  label: string;
  Icon: LucideIcon;
}

/** What a provider can list under, and what the marketplace filters on. */
export const CATEGORY_LIST: CategoryMeta[] = [
  { value: '', label: 'All', Icon: Boxes },
  { value: 'WEATHER', label: 'Weather', Icon: CloudSun },
  { value: 'FINANCIAL_ANALYSIS', label: 'Finance', Icon: TrendingUp },
  { value: 'NEWS', label: 'News', Icon: Newspaper },
  { value: 'DATA', label: 'Data', Icon: Database },
  { value: 'AI', label: 'AI', Icon: Bot },
  { value: 'DEVELOPER_TOOLS', label: 'Developer tools', Icon: Code2 },
  { value: 'OTHER', label: 'Other', Icon: Shapes },
];

/** Circle's categories, labelled when its catalog is switched on. */
const CIRCLE_CATEGORIES: CategoryMeta[] = [
  { value: 'WEB_SEARCH_RESEARCH', label: 'Search & research', Icon: Search },
  { value: 'SOCIAL_INTELLIGENCE', label: 'Social', Icon: Users },
  { value: 'PREDICTION_MARKETS', label: 'Prediction markets', Icon: Landmark },
  { value: 'CREATIVE', label: 'Creative', Icon: Palette },
  { value: 'INFRASTRUCTURE', label: 'Infrastructure', Icon: Server },
  { value: 'SPORTS', label: 'Sports', Icon: Trophy },
];

export function categoryMeta(value: string): CategoryMeta {
  return [...CATEGORY_LIST, ...CIRCLE_CATEGORIES].find((item) => item.value === value.toUpperCase()) ?? { value, label: value || 'Other', Icon: Shapes };
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export const shorten = (value: string, keep = 6) => (value.length > keep * 2 + 3 ? `${value.slice(0, keep)}…${value.slice(-keep)}` : value);

export interface ParamField {
  name: string;
  required: boolean;
  description?: string;
  example?: string;
}

type Schema = { properties?: Record<string, { description?: string; example?: unknown; examples?: unknown[]; default?: unknown }>; required?: string[] };

/**
 * Pulls simple query parameters out of a listing's input schema. Circle
 * listings describe input in a few shapes, so this checks the common ones and
 * gives up quietly on anything else.
 */
export function paramFields(input: unknown): ParamField[] {
  if (!input || typeof input !== 'object') return [];
  const root = input as Record<string, unknown>;
  const candidates = [root.queryParams, root.query, root.params, root];
  const schema = candidates.find(
    (item): item is Schema => !!item && typeof item === 'object' && typeof (item as Schema).properties === 'object',
  );
  if (!schema?.properties) return [];
  return Object.entries(schema.properties)
    .slice(0, 6)
    .map(([name, spec]) => {
      const example = spec?.example ?? spec?.examples?.[0] ?? spec?.default;
      return {
        name,
        required: schema.required?.includes(name) ?? false,
        description: spec?.description,
        example: example === undefined ? undefined : String(example),
      };
    });
}
