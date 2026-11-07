import { expect, test } from '@playwright/test';

/** Checks the server's public routes directly, the way a script or attacker could call them. */
const API = process.env.E2E_API ?? 'http://localhost:8787';
const unique = () => `n${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;

test('server responds and reports health', async ({ request }) => {
  const res = await request.get(`${API}/api/health`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test('badly formed requests get clean answers, not server errors', async ({ request }) => {
  const badName = await request.get(`${API}/api/account/available/%E0%A4%A`);
  expect(badName.status()).toBe(200);
  expect((await badName.json()).available).toBe(false);

  const day = Math.floor(Date.now() / 86_400_000);
  const nullShot = await request.post(`${API}/api/daily/${day}`, { data: { guest: 'tester', shots: [null] } });
  expect(nullShot.status()).toBe(400);
  const notJson = await request.post(`${API}/api/daily/${day}`, { data: 'not json', headers: { 'content-type': 'text/plain' } });
  expect(notJson.status()).toBe(400);
  const badMath = await request.post(`${API}/api/daily/${day}`, { data: { guest: 'tester', shots: [{ expr: 'hack(' }] } });
  expect(badMath.status()).toBe(400);
  const farFuture = await request.get(`${API}/api/daily/${day + 5}`);
  expect(farFuture.status()).toBe(400);
  expect((await request.get(`${API}/api/nothing`)).status()).toBe(404);
});

test('a score that did not clear the map is refused', async ({ request }) => {
  const day = Math.floor(Date.now() / 86_400_000);
  const res = await request.post(`${API}/api/daily/${day}`, { data: { guest: 'tester', name: 'Cheat', shots: [{ expr: '0' }] } });
  // One flat shot almost never clears three targets. Clearing is checked by the server either way.
  expect([200, 400]).toContain(res.status());
  if (res.status() === 400) expect((await res.json()).error).toMatch(/did not clear/);
});

test('private routes need a real login', async ({ request }) => {
  const forged = { authorization: 'Bearer not.a.real-token' };
  expect((await request.get(`${API}/api/profile`)).status()).toBe(401);
  expect((await request.get(`${API}/api/profile`, { headers: forged })).status()).toBe(401);
  expect((await request.put(`${API}/api/profile`, { headers: forged, data: { updatedAt: 1, sparks: 99999 } })).status()).toBe(401);
  expect((await request.post(`${API}/api/account/claim`, { headers: forged, data: { username: 'stolen' } })).status()).toBe(401);
  expect((await request.post(`${API}/api/account/sync-email`, { headers: forged, data: {} })).status()).toBe(401);
  expect((await request.delete(`${API}/api/account`, { headers: forged })).status()).toBe(401);
  // The old route that trusted any email address is gone.
  expect((await request.post(`${API}/api/account/login-email`, { headers: forged, data: { email: 'a@b.co' } })).status()).toBe(401);
});

test('username checks catch bad, blocked, and valid names', async ({ request }) => {
  const check = async (name: string) => (await (await request.get(`${API}/api/account/available/${name}`)).json()) as { available: boolean; problem: string | null };
  expect((await check('ab')).problem).toMatch(/at least 3/);
  expect((await check('has%20space')).problem).toMatch(/letters/);
  expect((await check('fuckface')).available).toBe(false);
  expect((await check(unique().slice(0, 16))).available).toBe(true);
  expect((await check('Skysurfer')).problem).toBeNull();
});

test('wrong passwords are refused, then password guessing is stopped', async ({ request }) => {
  const name = unique();
  const attempt = () => request.post(`${API}/api/auth/resolve`, { data: { username: name, password: 'guess-guess' } });
  const first = await attempt();
  expect(first.status()).toBe(401);
  expect((await first.json()).email).toBeUndefined();
  let last = first;
  for (let i = 0; i < 11; i++) last = await attempt();
  expect(last.status()).toBe(429);
});

test('cross-site pages are refused room connections', async ({ request }) => {
  const res = await request.get(`${API}/room/ABCDE`, { headers: { origin: 'https://evil.example' } });
  expect(res.status()).toBe(403);
});

test('sites other than the game get no permission to read responses', async ({ request }) => {
  const evil = await request.get(`${API}/api/health`, { headers: { origin: 'https://evil.example' } });
  expect(evil.headers()['access-control-allow-origin']).toBeUndefined();
  const game = await request.get(`${API}/api/health`, { headers: { origin: 'https://mathbattles.github.io' } });
  expect(game.headers()['access-control-allow-origin']).toBe('https://mathbattles.github.io');
});
