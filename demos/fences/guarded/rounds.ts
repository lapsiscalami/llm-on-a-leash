/**
 * A round-advance function with TWO load-bearing guards.
 *
 * Both exist because of real production bugs. Both are the kind of line a
 * future refactor deletes without noticing, because nothing about them
 * looks important and no unit test names them.
 *
 * That is what the fences in ../rules are for.
 */

export interface Game { id: string; currentRound: number }
export interface Ctx { patch(id: string, p: Partial<Game>): void }

export function advanceToNextRound(ctx: Ctx, game: Game, nextRoundNumber: number): void {
  // GUARD 1 — idempotency.
  // Round advance can be scheduled from several triggers near a boundary
  // (the last judgment landing, and the host clicking Finish Round). Without
  // this, both fire and the game skips a round.
  if (game.currentRound >= nextRoundNumber) return;

  ctx.patch(game.id, { currentRound: nextRoundNumber });
}

export function checkRoundCompletion(players: { submitted: boolean }[]): boolean {
  // GUARD 2 — no deadline check here, deliberately.
  // Round deadlines are SOFT. A round resolves ONLY when every player has
  // finalized, never because a timer expired. Adding `Date.now() > deadline`
  // here silently resolves rounds out from under players who are still typing.
  return players.every((p) => p.submitted);
}
