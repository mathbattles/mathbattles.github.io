import { describe, expect, it } from 'vitest';
import { createMatch, type ServerMsg } from '@mathbattles/sim';

// The room connection opens a WebSocket as soon as it is made; a silent stand-in is enough here.
class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(): void {}
  close(): void {}
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;

describe('a rematch starts with a clean game screen', async () => {
  const { NetSession } = await import('../src/game/session');
  const setups = [{ id: 'a', name: 'A', team: 1 as const }, { id: 'b', name: 'B', team: 2 as const }];
  const matchMsg = (seed: number): ServerMsg => ({ t: 'match', state: createMatch({ kind: 'teams', mode: 'fn', seed }, setups), setups, deadline: Date.now() + 45_000, serverNow: Date.now(), draft: null });
  const handle = (s: InstanceType<typeof NetSession>, msg: ServerMsg) => (s as unknown as { handle: (m: ServerMsg) => void }).handle(msg);

  it('counts each new match, but not the same match sent again after a reconnect', () => {
    const s = new NetSession('ws://test/room/ABCD', { t: 'join', name: 'A', token: 'x'.repeat(24) });
    handle(s, matchMsg(1));
    const first = s.matchNo;
    handle(s, matchMsg(1));
    expect(s.matchNo).toBe(first);
    handle(s, matchMsg(2));
    expect(s.matchNo).toBe(first + 1);
  });

  it('clears the last match’s rating change, rematch votes and error', () => {
    const s = new NetSession('ws://test/room/ABCD', { t: 'join', name: 'A', token: 'x'.repeat(24) });
    handle(s, matchMsg(3));
    s.ratingDelta = 16;
    s.rematchVotes = ['a', 'b'];
    s.error = 'Old error';
    handle(s, matchMsg(4));
    expect(s.ratingDelta).toBeUndefined();
    expect(s.rematchVotes).toEqual([]);
    expect(s.error).toBe('');
  });
});
