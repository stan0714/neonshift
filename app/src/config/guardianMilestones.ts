import type { ShoeLevel } from './shoeProgression';

/** Frozen educational references, not live wildlife censuses. New data requires a new version. */
export type PopulationReference = {
  version: string;
  threshold: number;
  qualifier: 'about' | 'fewerThan';
  estimateYear: number | null;
  reviewedAt: string;
  source: string;
};
export const GUARDIAN_REFERENCES: Partial<Record<ShoeLevel, PopulationReference>> = {
  2: { version: 'elephant-wwf-2026-09-19', threshold: 50_000, qualifier: 'fewerThan', estimateYear: null, reviewedAt: '2026-09-19', source: 'https://www.worldwildlife.org/news/stories/tackling-critical-threats-facing-asian-elephants/' },
  4: { version: 'tiger-gtf-2023-v1', threshold: 5_574, qualifier: 'about', estimateYear: 2023, reviewedAt: '2026-09-19', source: 'https://www.worldwildlife.org/news/stories/tigers-on-the-move/' },
  5: { version: 'leopard-wwfuk-2026-09-19', threshold: 130, qualifier: 'about', estimateYear: null, reviewedAt: '2026-09-19', source: 'https://www.wwf.org.uk/learn/wildlife/endangered-animals' },
};
// Hawksbill: no comparable worldwide, all-individual population estimate verified. Do not substitute nesting females.
export function guardianProgress(level: ShoeLevel, total: number | null) {
  const reference = GUARDIAN_REFERENCES[level];
  if (!reference) return { status: 'unavailable' as const, reference: null, remaining: null, ratio: 0 };
  if (total === null || !Number.isSafeInteger(total) || total < 0) return { status: 'unknown' as const, reference, remaining: null, ratio: 0 };
  return { status: total > reference.threshold ? 'unlocked' as const : 'building' as const, reference, remaining: Math.max(0, reference.threshold + 1 - total), ratio: Math.min(1, total / (reference.threshold + 1)) };
}
