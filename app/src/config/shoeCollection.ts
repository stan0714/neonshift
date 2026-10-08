import type { ShoeLevel } from './shoeProgression';

/** Append new editions; never change an existing ID/assignment algorithm. Cosmetic only. */
export const SHOE_SERIES = {
  'wild-guardians-v1': { id: 'wild-guardians-v1', nameKey: 'wild.series', edition: 1, variants: ['dawn', 'dusk', 'aurora'] },
} as const;
export type ShoeSeriesId = keyof typeof SHOE_SERIES;
export type ShoeVariant = 'dawn' | 'dusk' | 'aurora';
export const DEFAULT_SHOE_SERIES: ShoeSeriesId = 'wild-guardians-v1';
export const WILDLIFE = {
  2: { species: 'elephant', status: 'EN', scientific: 'Elephas maximus', source: 'https://www.worldwildlife.org/species/elephant/asian-elephant/' },
  3: { species: 'hawksbill', status: 'CR', scientific: 'Eretmochelys imbricata', source: 'https://www.worldwildlife.org/species/sea-turtle/hawksbill-turtle/' },
  4: { species: 'tiger', status: 'EN', scientific: 'Panthera tigris', source: 'https://www.worldwildlife.org/species/tiger/' },
  5: { species: 'leopard', status: 'CR', scientific: 'Panthera pardus orientalis', source: 'https://www.worldwildlife.org/species/amur-leopard/' },
} as const;
export const wildlifeOf = (level: ShoeLevel) => level === 1 ? null : WILDLIFE[level];

/** Stable wallet/series/level assignment, NOT secure randomness or an on-chain NFT trait. */
export function shoeVariant(owner: string | null, level: ShoeLevel, series: ShoeSeriesId = DEFAULT_SHOE_SERIES): ShoeVariant | null {
  if (!owner || level === 1) return null;
  let hash = 2166136261;
  for (const c of `${series}:${owner}:${level}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  const variants = SHOE_SERIES[series].variants;
  return variants[hash % variants.length];
}
