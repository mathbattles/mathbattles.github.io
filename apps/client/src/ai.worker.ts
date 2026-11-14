import { chooseMove, type MatchState } from '@mathbattles/sim';

self.onmessage = (e: MessageEvent<{ id: number; state: MatchState; playerId: string; generations: number; aimError: number; seed: number; budgetMs: number; useAbilities?: boolean }>) => {
  const { id, state, playerId, generations, aimError, seed, budgetMs, useAbilities } = e.data;
  const move = chooseMove(state, { playerId, generations, aimError, seed, budgetMs, useAbilities, now: () => performance.now() });
  self.postMessage({ id, move });
};
