/**
 * Fixture for the pin-the-fix skill test. A toy engine with two lines worth
 * fencing: one that must stay (the destroyed-item guard) and one that must
 * never appear (randomness in the combat resolver).
 */
export interface Inventory { items: Map<string, number>; destroyed: Set<string> }
export interface Combat { attack: number; defence: number }

export function consumeItem(inv: Inventory, id: string): boolean {
  // GUARD: an item destroyed earlier this turn must not be consumed again.
  // Both the "use item" click and the end-of-turn sweep call this. Without
  // the check a destroyed item is consumed twice and its count goes negative.
  if (inv.destroyed.has(id)) return false;
  const n = inv.items.get(id) ?? 0;
  if (n <= 0) return false;
  inv.items.set(id, n - 1);
  return true;
}

export function resolveCombat(c: Combat): "attacker" | "defender" {
  // No randomness here, deliberately. The outcome must be reproducible from
  // the board so replays and disputes agree. Adding Math.random() makes two
  // replays of the same game disagree.
  return c.attack > c.defence ? "attacker" : "defender";
}
