import { shoeVariant, wildlifeOf, SHOE_SERIES } from '@/config/shoeCollection';
import type { ShoeLevel } from '@/config/shoeProgression';

test('ordinary shoe has no animal or variant; unauthenticated previews are not assigned', () => {
  expect(wildlifeOf(1)).toBeNull();
  expect(shoeVariant('wallet-a', 1)).toBeNull();
  expect(shoeVariant(null, 3)).toBeNull();
});
test.each([2, 3, 4, 5] as ShoeLevel[])('level %i uses a documented endangered species', level => {
  const animal = wildlifeOf(level)!;
  expect(['EN', 'CR']).toContain(animal.status);
  expect(animal.source.startsWith('https://www.worldwildlife.org/')).toBe(true);
});
test('assignment is reproducible across sessions and frozen for this edition', () => {
  const first = [2, 3, 4, 5].map(level => shoeVariant('wallet-a', level as ShoeLevel));
  expect(first).toEqual([2, 3, 4, 5].map(level => shoeVariant('wallet-a', level as ShoeLevel)));
  expect(first).toMatchInlineSnapshot(`
[
  "dusk",
  "aurora",
  "dawn",
  "dusk",
]
`);
});
test('wallets can receive each of the three cosmetic finishes', () => {
  const finishes = new Set(Array.from({ length: 100 }, (_, n) => shoeVariant(`wallet-${n}`, 3)));
  expect([...finishes].sort()).toEqual([...SHOE_SERIES['wild-guardians-v1'].variants].sort());
});
