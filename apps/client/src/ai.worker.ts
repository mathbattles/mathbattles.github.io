import { chooseMove, type MatchState } from '@mathbattles/sim';

self.onmessage = (e: MessageEvent<{ id: number; state: MatchState; generations: number; aimError: number; seed: number; budgetMs: number }>) => {
  const { id, state, generations, aimError, seed, budgetMs } = e.data;
  const move = chooseMove(state, { generations, aimError, seed, budgetMs, now: () => performance.now() });
  self.postMessage({ id, move });
};
