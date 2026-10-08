/** Saved artwork is immutable, even when metrics receive a new source revision. */
export function freezeWorkoutArtwork(incoming: Record<string, unknown>, existing?: Record<string, unknown>): Record<string, unknown> {
  const candidate = (existing ?? incoming).route_appearance as { version?: unknown; layer?: unknown } | null | undefined;
  const layers = ['grid', 'mars', 'chain', 'space', 'forest', 'ocean', 'jungle', 'snow'];
  const route = candidate?.version === 1 && typeof candidate.layer === 'string' && layers.includes(candidate.layer)
    ? { version: 1, layer: candidate.layer } : { version: 1, layer: 'grid' };
  return { ...incoming, route_appearance: route };
}
