import { describe, expect, it } from 'vitest';
import { DEMOS, buildDemo } from '../src/render/demo';

describe('menu and shop demo shots', () => {
  for (const rocks of [2, 6]) {
    it(`reach both enemies before hitting a rock, with ${rocks} rocks`, () => {
      for (let i = 0; i < DEMOS.length; i++) {
        const demo = buildDemo(i, rocks);
        // Both soldiers are really on the drawn path.
        expect(demo.record.hits.map((h) => h.id).sort()).toEqual([1, 2]);
        for (const h of demo.record.hits) expect(h.step).toBeGreaterThan(0);
        // The shot ends on the rock placed near the end, inside the field, not early on a side rock.
        expect(demo.record.reason).toBe('obstacle');
        // Every side rock found a clear spot, so the board doesn't look empty.
        expect(demo.state.circles.length).toBe(rocks + 1);
        const endRock = demo.state.circles[demo.state.circles.length - 1]!;
        expect(Math.hypot(demo.record.end.x - endRock.x, demo.record.end.y - endRock.y)).toBeLessThan(endRock.r + 3);
        const lastHit = Math.max(...demo.record.hits.map((h) => h.step));
        expect(demo.path.steps).toBeGreaterThan(lastHit);
      }
    });
  }
});
