import { color } from '@/theme/tokens';

export type ShoeLevel = 1 | 2 | 3 | 4 | 5;

/** Design defaults for preview only; live rewards and levels must come from chain Config/Profile. */
export const SHOE_PROGRESSION = {
  version: 1,
  xpPerClaim: { steps: 100, sleep: 50 },
  stages: [
    { level: 1, name: 'Origin', xp: 0, tint: color.textSecondary, accent: color.textMuted, material: color.elevated, detail: 'Graphite mesh · single light rail' },
    { level: 2, name: 'Pulse', xp: 450, tint: color.cyan, accent: color.mint, material: color.borderSubtle, detail: 'Twin rails · reinforced heel' },
    { level: 3, name: 'Phase', xp: 1500, tint: color.violet, accent: color.cyan, material: color.elevated, detail: 'Side exoskeleton · split sole' },
    { level: 4, name: 'Surge', xp: 3600, tint: color.magenta, accent: color.violet, material: color.borderSubtle, detail: 'Heel fins · energy chamber' },
    { level: 5, name: 'Zenith', xp: 7500, tint: color.mint, accent: color.violet, material: color.textMuted, detail: 'Pearl armor · floating sole pods' },
  ],
} as const;

/** Pure preview calculator: no mutation of wallet state and no reward authorization. */
export function getPreviewShoeProgress(xp: number) {
  if (!Number.isSafeInteger(xp) || xp < 0) throw new RangeError('XP must be a non-negative safe integer');
  const stages = SHOE_PROGRESSION.stages;
  const stage = [...stages].reverse().find((item) => xp >= item.xp)!;
  const next = stages.find((item) => item.level === stage.level + 1);
  return { stage, next, remainingXp: next ? next.xp - xp : 0, progress: next ? (xp - stage.xp) / (next.xp - stage.xp) : 1 };
}
