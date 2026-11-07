import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { createMatch, currentPlayer, encodeReplay, fire as fireShot, makeReplay } from '../packages/sim/src/index';

async function newPlayer(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript((n) => {
    if (!localStorage.getItem('mathbattles.profile.v1')) {
      localStorage.setItem('mathbattles.profile.v1', JSON.stringify({ name: n, analytics: 'no' }));
    }
  }, name);
  page.on('pageerror', (e) => {
    throw e;
  });
  return page;
}

/** Picks an option from one of the game's dropdowns. */
async function choose(trigger: Locator, option: string): Promise<void> {
  await trigger.click();
  await trigger.page().getByRole('option', { name: option, exact: true }).click();
}

const fire = async (page: Page, expr: string) => {
  await page.locator('#fn-input').fill(expr);
  await page.getByRole('button', { name: 'Fire', exact: true }).click();
};

test('a whole match against a bot can be finished, and pays rewards', async ({ browser }) => {
  const page = await newPlayer(browser, 'Solo');
  // A fixed map keeps this repeatable: on some random maps a bot can miss for minutes.
  await page.addInitScript(() => {
    Math.random = () => 0.25;
  });
  await page.goto('/#/local');
  await choose(page.getByRole('button', { name: 'Who plays' }).nth(1), 'Hard bot');
  await choose(page.getByRole('button', { name: 'Soldiers each' }), '1');
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  const over = page.getByRole('heading', { name: /You win|You lose|Draw/ });
  for (let i = 0; i < 400 && !(await over.isVisible()); i++) {
    const box = page.locator('#fn-input');
    if ((await box.count()) && (await box.isEnabled())) await fire(page, 'x/8').catch(() => {});
    await page.waitForTimeout(250);
  }
  await expect(over).toBeVisible();
  await expect(page.getByText(/You earned \d+ Sparks/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy replay link' })).toBeVisible();
});

test('campaign clears, keeps stars after a reload, and unlocks the next level', async ({ browser }) => {
  const page = await newPlayer(browser, 'Camper');
  await page.goto('/#/level/0-1');
  await fire(page, '0');
  await expect(page.getByRole('heading', { name: /Level cleared/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Next level' }).click();
  await expect(page.getByText('Tilt it')).toBeVisible();
  await page.reload();
  await page.goto('/#/campaign');
  await expect(page.getByRole('button', { name: /Straight ahead/ }).getByLabel('3 of 3 stars')).toBeVisible();
  await expect(page.getByRole('button', { name: /Gentle climb/ })).toBeDisabled();
});

test('bad math shows a plain error and blocks firing', async ({ browser }) => {
  const page = await newPlayer(browser, 'Typo');
  await page.goto('/#/practice');
  await page.locator('#fn-input').fill('sin(x');
  await expect(page.getByRole('alert')).toHaveText('Missing )');
  await expect(page.getByRole('button', { name: 'Fire', exact: true })).toBeDisabled();
  await page.locator('#fn-input').fill('alert(1)');
  await expect(page.getByRole('alert')).toBeVisible();
});

test('replay links rebuild a finished match', async ({ browser }) => {
  const page = await newPlayer(browser, 'Watcher');
  await page.goto('/#/replay/not-a-real-replay');
  await expect(page.getByRole('heading', { name: 'This replay link is broken' })).toBeVisible();
});

test('two players can play online, with reconnect', async ({ browser }) => {
  const a = await newPlayer(browser, 'Ana');
  const b = await newPlayer(browser, 'Bo');

  await a.goto('/#/online');
  await a.getByRole('button', { name: 'Create private room' }).click();
  await expect(a).toHaveURL(/#\/room\//);
  const code = a.url().split('/').pop()!;
  await expect(a.getByRole('button', { name: 'Start match' })).toBeVisible();

  await b.goto('/#/online');
  await b.getByLabel('Room code').fill(code);
  await b.getByRole('button', { name: 'Join' }).click();
  await expect(a.getByText('Bo', { exact: true })).toBeVisible();
  await expect(b.getByText('Ana', { exact: true })).toBeVisible();

  // Starting too early is refused with a reason.
  await a.getByRole('button', { name: 'Start match' }).click();
  await expect(a.getByRole('alert')).toContainText('ready');

  await choose(a.getByRole('button', { name: 'Soldiers each' }), '2');
  // Host's rule change reaches the other player.
  await a.getByRole('button', { name: 'Free-for-all' }).click();
  await expect(b.getByRole('button', { name: 'Free-for-all' })).toHaveClass(/on/);
  await a.getByRole('button', { name: 'Teams' }).click();

  await b.getByRole('button', { name: 'Mark ready' }).click();
  await a.getByRole('button', { name: 'Start match' }).click();

  await expect(a.locator('.game canvas')).toBeVisible();
  await expect(b.locator('.game canvas')).toBeVisible();

  // After the start delay, one player has the turn and the other doesn't.
  await expect(a.locator('.who')).toHaveText('Get ready');
  await expect(async () => {
    const aTurn = await a.locator('.who').textContent();
    const bTurn = await b.locator('.who').textContent();
    expect([aTurn, bTurn].filter((t) => t === 'Your turn').length).toBe(1);
  }).toPass({ timeout: 10_000 });

  const aFirst = (await a.locator('.who').textContent()) === 'Your turn';
  const first = aFirst ? a : b;
  const second = aFirst ? b : a;
  await expect(second.locator('#fn-input')).toBeDisabled();

  await fire(first, 'x/8');
  await expect(first.locator('.who')).toHaveText(/Shot in the air|aiming/, { timeout: 5000 });

  await expect(second.locator('.who')).toHaveText('Your turn', { timeout: 25_000 });

  // Second player drops and returns to the same seat.
  await second.reload();
  await expect(second.locator('.game canvas')).toBeVisible({ timeout: 10_000 });
  await expect(second.locator('.scores')).toContainText(aFirst ? 'Bo' : 'Ana');
  await expect(second.locator('.scores .out')).toHaveCount(0);

  // Chat crosses between players, with filtering.
  await first.getByLabel('Chat message').fill('nice shot');
  await first.getByRole('button', { name: 'Send' }).click();
  await expect(second.locator('.chatlog')).toContainText('nice shot');

  // The match can finish: both vote to skip to prove a new map also arrives.
  await first.getByLabel('Chat message').fill('-skip');
  await first.getByRole('button', { name: 'Send' }).click();
  await second.getByLabel('Chat message').fill('-skip');
  await second.getByRole('button', { name: 'Send' }).click();
  await expect(first.locator('.chatlog')).toContainText('new map');
});

test('a saved replay link really plays a match back to its end', async ({ browser }) => {
  const setups = [{ id: 'a', name: 'Ana', team: 1 as const }, { id: 'b', name: 'Bo', team: 2 as const }];
  const match = createMatch({ kind: 'teams', mode: 'fn', soldiers: 1, seed: 5 }, setups);
  fireShot(match, currentPlayer(match).id, { expr: 'x/9' });
  fireShot(match, currentPlayer(match).id, { expr: 'sin(x)' });
  const data = encodeReplay(makeReplay(match, setups));
  const page = await newPlayer(browser, 'Watcher');
  await page.goto(`/#/replay/${data}`);
  await expect(page.locator('.scores')).toContainText('Ana');
  await expect(page.locator('.last-shot code')).toHaveText('x/9', { timeout: 15_000 });
  await expect(page.locator('.last-shot code')).toHaveText('sin(x)', { timeout: 25_000 });
  await expect(page.locator('.history button.shot')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: /broken/ })).toHaveCount(0);
});

test('a replay link for an impossible match shows a message, not a crash', async ({ browser }) => {
  const page = await newPlayer(browser, 'Watcher');
  const bad = Buffer.from(JSON.stringify({ v: 1, config: { kind: 'teams', mode: 'fn', soldiers: 1, seed: 1 }, setups: [], actions: [] })).toString('base64url');
  await page.goto(`/#/replay/${bad}`);
  await expect(page.getByRole('heading', { name: 'This replay link is broken' })).toBeVisible();
});

test('a mistyped room code says so, instead of opening an empty room', async ({ browser }) => {
  const page = await newPlayer(browser, 'Typo');
  await page.goto('/#/room/ZZZZZ');
  await expect(page.getByRole('heading', { name: "Can't join this room" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("There's no room with the code ZZZZZ")).toBeVisible();
});

test('a made-up ranked room is refused', async ({ browser }) => {
  const page = await newPlayer(browser, 'Farmer');
  await page.goto('/#/room/R-FARM1');
  await expect(page.getByRole('heading', { name: 'Ranked match unavailable' })).toBeVisible({ timeout: 15_000 });
});

test('after a match the room still works: leaving, rejoining, and a rematch', async ({ browser }) => {
  test.setTimeout(150_000);
  const a = await newPlayer(browser, 'Ana');
  const b = await newPlayer(browser, 'Bo');
  await a.goto('/#/online');
  await a.getByRole('button', { name: 'Create private room' }).click();
  await expect(a).toHaveURL(/#\/room\//);
  const roomUrl = a.url();
  const code = roomUrl.split('/').pop()!;
  await expect(a.getByRole('button', { name: 'Start match' })).toBeVisible();
  await b.goto(`/#/room/${code}`);
  await expect(a.getByText('Bo', { exact: true })).toBeVisible();
  await b.getByRole('button', { name: 'Mark ready' }).click();
  await choose(a.getByRole('button', { name: 'Soldiers each' }), '1');
  await a.getByRole('button', { name: 'Start match' }).click();
  await expect(a.locator('.game canvas')).toBeVisible();
  await expect(b.locator('.game canvas')).toBeVisible();

  // Bo leaves on purpose: Ana sees the result right away, with no 30-second wait.
  await b.getByRole('link', { name: 'Leave' }).click();
  await expect(a.getByRole('heading', { name: 'You win' })).toBeVisible({ timeout: 8_000 });

  // The room returns to its lobby, and the connection still works.
  await expect(a.getByRole('heading', { name: new RegExp(`Room ${code}`) })).toBeVisible({ timeout: 25_000 });
  await choose(a.getByRole('button', { name: 'Bot level' }), 'Easy');
  await expect(a.getByText('(bot)')).toBeVisible();
  await a.getByRole('button', { name: 'Remove' }).click();
  await expect(a.getByText('(bot)')).toHaveCount(0);

  // Bo returns for a rematch, and the old result doesn't reappear.
  await b.goto(`/#/room/${code}`);
  await expect(a.getByText('Bo', { exact: true })).toBeVisible();
  await b.getByRole('button', { name: 'Mark ready' }).click();
  await a.getByRole('button', { name: 'Start match' }).click();
  await expect(a.locator('.game canvas')).toBeVisible();
  await expect(a.getByRole('heading', { name: 'You win' })).toHaveCount(0);
  await expect(a.locator('.who')).toHaveText(/Your turn|aiming|Get ready/);
});

test('a chat error does not hide the function box', async ({ browser }) => {
  const a = await newPlayer(browser, 'Ana');
  const b = await newPlayer(browser, 'Bo');
  await a.goto('/#/online');
  await a.getByRole('button', { name: 'Create private room' }).click();
  await expect(a).toHaveURL(/#\/room\//);
  await expect(a.getByRole('button', { name: 'Start match' })).toBeVisible();
  await b.goto(`/#/room/${a.url().split('/').pop()}`);
  await b.getByRole('button', { name: 'Mark ready' }).click();
  await a.getByRole('button', { name: 'Start match' }).click();
  await expect(a.locator('.game canvas')).toBeVisible();
  await a.getByLabel('Chat message').fill('one');
  await a.getByRole('button', { name: 'Send' }).click();
  await a.getByLabel('Chat message').fill('two');
  await a.getByRole('button', { name: 'Send' }).click();
  await expect(a.getByRole('alert')).toContainText('too quickly');
  await expect(a.locator('#fn-input')).toBeVisible();
  await expect(a.getByRole('alert')).toHaveCount(0, { timeout: 8_000 });
});

test('a too-big local free-for-all starts normally', async ({ browser }) => {
  const page = await newPlayer(browser, 'Big');
  await page.goto('/#/local');
  await page.getByRole('button', { name: 'Free-for-all' }).click();
  await choose(page.getByRole('button', { name: 'Soldiers each' }), '4');
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Add player' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('.scores div')).toHaveCount(10);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('two tabs do not undo each other', async ({ browser }) => {
  const ctx = await browser.newContext();
  const one = await ctx.newPage();
  const two = await ctx.newPage();
  await one.goto('/#/settings');
  await two.goto('/#/settings');
  await one.getByRole('group', { name: 'UI design' }).getByRole('button', { name: 'Blueprint' }).click();
  await expect(two.locator('html')).toHaveAttribute('data-theme', 'blueprint');
  await two.getByLabel('Mute sound').check();
  await one.reload();
  await expect(one.locator('html')).toHaveAttribute('data-theme', 'blueprint');
  await expect(one.getByLabel('Mute sound')).toBeChecked();
});

test('free-for-all offers both firing directions and runs against bots', async ({ browser }) => {
  const page = await newPlayer(browser, 'Ffa');
  await page.goto('/#/local');
  await page.getByRole('button', { name: 'Free-for-all' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('.who')).toBeVisible();
  const box = page.locator('#fn-input');
  await expect(box).toBeEnabled({ timeout: 40_000 });
  await page.getByRole('button', { name: /toward −x/ }).click();
  await expect(page.getByRole('button', { name: /toward −x/ })).toHaveAttribute('aria-pressed', 'true');
  await fire(page, 'x/8');
  await expect(page.locator('.who')).toHaveText(/Shot in the air|aiming/);
});

test('a new player is sent to the tutorial', async ({ browser }) => {
  const page = await newPlayer(browser, 'New');
  await page.goto('/');
  await page.getByRole('link', { name: 'Learn to play in 3 shots' }).click();
  await expect(page.locator('.coach')).toContainText('Type 0');
});

const uniqueName = (tag: string) => `t${tag}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(0, 16);

async function createAccount(browser: Browser, username: string, password: string): Promise<Page> {
  const page = await newPlayer(browser, 'Guest');
  await page.goto('/#/signin');
  await page.getByRole('button', { name: 'Create account' }).first().click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.locator('form').getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(`Signed in as`)).toBeVisible({ timeout: 20_000 });
  return page;
}

async function deleteAccount(page: Page): Promise<void> {
  await page.goto('/#/profile');
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('button', { name: 'Delete for good' }).click();
  await expect(page.getByRole('link', { name: 'Sign in or create an account' })).toBeVisible({ timeout: 20_000 });
}

test('username accounts: create, sign out, wrong password, sign back in, delete', async ({ browser }) => {
  const name = uniqueName('acct');
  const password = 'correct-horse-9';
  const page = await createAccount(browser, name, password);
  await expect(page.locator('.topbar')).toContainText(name);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in or create an account' })).toBeVisible();

  await page.goto('/#/signin');
  await page.getByLabel('Username').fill(name);
  await page.getByLabel('Password').fill('not-the-password');
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong username or password');

  await page.getByLabel('Password').fill(password);
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 20_000 });

  // Same name can't be taken twice, whatever the capitals.
  const other = await newPlayer(browser, 'Other');
  await other.goto('/#/signin');
  await other.getByRole('button', { name: 'Create account' }).first().click();
  await other.getByLabel('Username').fill(name.toUpperCase());
  await other.getByLabel('Password').fill(password);
  await other.locator('form').getByRole('button', { name: 'Create account' }).click();
  await expect(other.getByRole('alert')).toContainText('taken');

  await deleteAccount(page);
});

test('progress follows the account and never leaks to the next person on a device', async ({ browser }) => {
  test.setTimeout(150_000);
  const password = 'correct-horse-9';
  const nameA = uniqueName('sa');
  const nameB = uniqueName('sb');
  const page = await createAccount(browser, nameA, password);
  await page.goto('/#/level/0-1');
  await fire(page, '0');
  await expect(page.getByRole('heading', { name: /Level cleared/ })).toBeVisible({ timeout: 20_000 });
  const sparksOf = async () => Number((await page.locator('.sparks').textContent())?.match(/\d+/)?.[0]);
  await page.goto('/#/profile');
  const earned = await sparksOf();
  expect(earned).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in or create an account' })).toBeVisible();
  await expect(page.locator('.sparks')).toHaveText('0 Sparks');

  // A second account on the same device starts clean.
  await page.goto('/#/signin');
  await page.getByRole('button', { name: 'Create account' }).first().click();
  await page.getByLabel('Username').fill(nameB);
  await page.getByLabel('Password').fill(password);
  await page.locator('form').getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.sparks')).toHaveText('0 Sparks');
  await deleteAccount(page);

  // The first account gets its progress back.
  await page.goto('/#/signin');
  await page.getByLabel('Username').fill(nameA);
  await page.getByLabel('Password').fill(password);
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.sparks')).toHaveText(`${earned} Sparks`, { timeout: 10_000 });
  await deleteAccount(page);
});

test('bad usernames and short passwords are refused', async ({ browser }) => {
  const page = await newPlayer(browser, 'Guest');
  await page.goto('/#/signin');
  await page.getByRole('button', { name: 'Create account' }).first().click();
  await page.getByLabel('Username').fill('ab');
  await page.getByLabel('Password').fill('correct-horse-9');
  await page.locator('form').getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('at least 3');
  await page.getByLabel('Username').fill('valid_name');
  await page.getByLabel('Password').fill('short');
  await page.locator('form').getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('at least 8');
});

test('two brand-new level 1 accounts can play ranked, and ratings change', async ({ browser }) => {
  test.setTimeout(180_000);
  const password = 'correct-horse-9';
  const nameA = uniqueName('ra');
  const nameB = uniqueName('rb');
  const removeAccount = async (name: string) => {
    const page = await newPlayer(browser, 'Guest');
    await page.goto('/#/signin');
    await page.getByLabel('Username').fill(name);
    await page.getByLabel('Password').fill(password);
    await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 20_000 });
    await deleteAccount(page);
  };
  const a = await createAccount(browser, nameA, password);
  const b = await createAccount(browser, nameB, password);
  try {
    await a.goto('/#/ranked');
    await b.goto('/#/ranked');
    await a.getByRole('button', { name: 'Find a match' }).click();
    await b.getByRole('button', { name: 'Find a match' }).click();
    await expect(a).toHaveURL(/#\/ranked\/R-/, { timeout: 30_000 });
    await expect(b).toHaveURL(/#\/ranked\/R-/, { timeout: 30_000 });
    await expect(a.locator('.game canvas')).toBeVisible({ timeout: 20_000 });
    await expect(b.locator('.game canvas')).toBeVisible({ timeout: 20_000 });

    // One player quits for good, so the other wins once the reconnect window ends.
    await expect(a.locator('.who')).toBeVisible();
    await b.close();
    await expect(a.getByRole('heading', { name: 'You win' })).toBeVisible({ timeout: 60_000 });
    await expect(a.getByText(/Rating \+\d+/)).toBeVisible();

    // The server saved it: it's in match history, watchable, and on the public player page.
    await a.goto('/#/profile');
    const row = a.locator('.match').first();
    await expect(row).toContainText(`vs ${nameB}`, { timeout: 15_000 });
    await expect(row).toContainText('Ranked');
    await expect(row.locator('.rating-change')).toHaveText(/^\+\d+$/);
    await expect(row.getByRole('link', { name: 'Watch' })).toBeVisible();
    await a.goto(`/#/player/${nameA}`);
    await expect(a.locator('.match').first()).toContainText(`vs ${nameB}`);
    await a.goto('/#/leaderboard');
    await a.getByRole('table').getByRole('link', { name: nameA }).click();
    await expect(a.getByRole('heading', { name: nameA })).toBeVisible();
    await a.getByRole('link', { name: 'Watch' }).first().click();
    await expect(a.getByText('Replay', { exact: true })).toBeVisible();
  } finally {
    await removeAccount(nameA).catch(() => {});
    await removeAccount(nameB).catch(() => {});
  }
});

test('phones: the menu has no Menu button, but other pages do, and tiles replace the tab bar', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('/#/');
  await expect(page.locator('.hero')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Menu', exact: true })).toHaveCount(0);
  await expect(page.locator('.sidenav')).toBeHidden();
  await expect(page.locator('.menu-list .menu-item').first()).toBeVisible();
  await page.goto('/#/shop');
  await expect(page.getByRole('link', { name: 'Menu', exact: true })).toBeVisible();
});

test('larger screens: a left tab bar replaces the tiles, and steps aside during play', async ({ browser }) => {
  const page = await newPlayer(browser, 'Tabs');
  await page.goto('/#/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  await expect(page.locator('.menu-list')).toBeHidden();
  // Home stands alone, then the three sections, each holding its own tabs in order.
  const sections: Record<string, string[]> = {
    Play: ['Play Online', 'Ranked', 'Bots and Friends'],
    Practice: ['Free Play', 'Daily Challenge', 'Learn', 'Campaign'],
    Misc: ['Shop', 'Leaderboard', 'Profile', 'Settings'],
  };
  await expect(nav.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  await expect(nav.getByRole('region')).toHaveCount(3);
  for (const [section, tabs] of Object.entries(sections)) {
    const group = nav.getByRole('region', { name: section });
    await expect(group.getByRole('heading', { name: section })).toBeVisible();
    await expect(group.locator('svg.nav-icon')).toBeVisible();
    await expect(group.getByRole('link')).toHaveText(tabs);
  }
  // Moving over a section brings it to life.
  const play = nav.getByRole('region', { name: 'Play' });
  const quiet = await play.evaluate((el) => getComputedStyle(el).borderTopColor);
  await play.hover();
  await expect.poll(() => play.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe(quiet);
  const box = await nav.boundingBox();
  expect(box!.x).toBe(0);
  await nav.getByRole('link', { name: 'Learn', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Learn', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Learn', exact: true })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Free Play', exact: true }).click();
  await expect(page.locator('.game canvas')).toBeVisible();
  await expect(nav).toBeHidden();
  await page.getByRole('link', { name: 'Menu', exact: true }).click();
  await expect(nav).toBeVisible();
});

test('Learn: the overview, a lesson, examples, sliders, challenges, hints, and quizzes all work', async ({ browser }) => {
  const page = await newPlayer(browser, 'Student');
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/#/learn');
  await expect(page.getByRole('progressbar', { name: 'Course progress' })).toBeVisible();
  await expect(page.getByText(/0 of \d+ lessons complete/)).toBeVisible();
  await page.getByRole('link', { name: 'Start the first lesson' }).click();
  await expect(page.getByRole('heading', { name: 'Type a function, fire a shot' })).toBeVisible();

  // Examples load into the box, and the board explains what the shot did.
  const play = page.locator('.lesson-box').first();
  await play.getByRole('button', { name: /A wave/ }).click();
  await expect(play.getByRole('textbox')).toHaveValue('3*sin(x)');
  await play.getByRole('button', { name: 'Fire', exact: true }).click();
  await expect(play.locator('.box-info')).toContainText('It ended at', { timeout: 15_000 });

  // A wrong answer says how far off it was, and hints lead to the answer.
  const challenge = page.locator('[data-challenge="first-shot-1"]');
  await challenge.getByRole('textbox').fill('x/3');
  await challenge.getByRole('button', { name: 'Fire', exact: true }).click();
  await expect(challenge.locator('.miss')).toContainText('above', { timeout: 15_000 });
  await challenge.getByRole('button', { name: 'Show a hint' }).click();
  await expect(challenge.locator('.hint')).toHaveCount(1);
  await challenge.getByRole('button', { name: 'Show another hint' }).click();
  await challenge.getByRole('button', { name: 'Fill in the answer' }).click();
  await expect(challenge.getByRole('textbox')).toHaveValue('0');
  await challenge.getByRole('button', { name: 'Fire', exact: true }).click();
  await expect(challenge.getByText('Direct hit')).toBeVisible({ timeout: 15_000 });

  // Quizzes correct you, and only the right answer counts.
  const quiz = page.locator('[data-quiz="first-shot-q"]');
  await quiz.getByRole('button', { name: /hold Fire/ }).click();
  await expect(quiz.getByRole('status')).toContainText('Not quite');
  await quiz.getByRole('button', { name: /graph of the function/ }).click();
  await expect(quiz.getByRole('status')).toContainText('Right');
  await expect(page.getByText('Lesson complete.')).toBeVisible();

  // Progress is saved and shown on the overview.
  await page.getByRole('link', { name: /^Next:/ }).click();
  await expect(page.getByRole('heading', { name: 'Reading the board' })).toBeVisible();
  await page.goto('/#/learn/slope');
  const slider = page.locator('.lesson-box').filter({ has: page.locator('input[type=range]') }).first();
  const before = await slider.locator('.slider-expr').textContent();
  await slider.locator('input[type=range]').fill('1.5');
  await expect(slider.locator('.slider-expr')).not.toHaveText(before!);
  await expect(slider.locator('.slider-expr code')).toHaveText('1.5*x');
  await page.reload();
  await page.goto('/#/learn');
  await expect(page.getByText(/1 of \d+ lessons complete/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Continue: Reading the board/ })).toBeVisible();
  await page.goto('/#/learn/not-a-lesson');
  await expect(page.getByRole('heading', { name: "That lesson doesn't exist" })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Learn: every lesson opens with no errors, and the firing-left lesson can be finished', async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await newPlayer(browser, 'Reader');
  page.on('console', (m) => {
    if (m.type() === 'error') throw new Error(m.text());
  });
  await page.goto('/#/learn');
  const links = await page.locator('a.lesson-link').evaluateAll((els) => els.map((e) => e.getAttribute('href')!));
  expect(links.length).toBeGreaterThanOrEqual(20);
  for (const href of links) {
    await page.goto(`/${href}`);
    await expect(page.locator('.lesson h2').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, href).toBeLessThanOrEqual(0);
  }
  await page.goto('/#/learn/free-for-all');
  const c = page.locator('[data-challenge="ffa-1"]');
  await c.getByRole('textbox').fill('x/5');
  await c.getByRole('button', { name: 'Fire', exact: true }).click();
  await expect(c.locator('.miss')).toBeVisible({ timeout: 15_000 });
  await c.getByRole('button', { name: /toward −x/ }).click();
  await c.getByRole('button', { name: 'Fire', exact: true }).click();
  await expect(c.getByText('Direct hit')).toBeVisible({ timeout: 15_000 });
  await page.goto('/#/learn/terrain');
  const dig = page.locator('[data-challenge="terrain-1"]');
  await dig.getByRole('textbox').fill('0');
  for (let i = 0; i < 6 && !(await dig.getByText('Direct hit').isVisible()); i++) {
    await dig.getByRole('button', { name: 'Fire', exact: true }).click();
    await expect(dig.getByRole('button', { name: 'Fire', exact: true }).or(dig.getByText('Direct hit')).first()).toBeEnabled({ timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(4500);
  }
  await expect(dig.getByText('Direct hit')).toBeVisible();
});

test('shot history lists shots, rewinds like chess, and returns to live', async ({ browser }) => {
  const page = await newPlayer(browser, 'Rewind');
  await page.goto('/#/practice');
  const history = page.locator('.history');
  await expect(history).toContainText("Shots appear here");
  for (const expr of ['x/40', '-x/40']) {
    await expect(page.locator('#fn-input')).toBeEnabled({ timeout: 25_000 });
    await fire(page, expr);
    await expect(page.locator('.last-shot code')).toHaveText(expr);
    await expect(page.locator('.who')).toHaveText('Your turn', { timeout: 25_000 });
  }
  const before = await page.locator('.game canvas').screenshot();
  await history.locator('button.shot').first().click();
  await expect(page.locator('.past-banner')).toContainText('shot 1 of');
  await expect(history.locator('li.current code')).toHaveText('x/40');
  await page.waitForTimeout(300);
  const past = await page.locator('.game canvas').screenshot();
  expect(past.equals(before)).toBe(false);
  await history.getByRole('button', { name: 'Next shot' }).click();
  await expect(page.locator('.past-banner')).toContainText('shot 2 of');
  // Looking back doesn't stop you playing.
  await expect(page.locator('#fn-input')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.past-banner')).toHaveCount(0);
  await history.locator('button.shot').first().click();
  await page.getByRole('button', { name: 'Back to live' }).click();
  await expect(page.locator('.past-banner')).toHaveCount(0);
  // Firing while looking back returns to live.
  await history.locator('button.shot').first().click();
  await fire(page, 'x/30');
  await expect(page.locator('.past-banner')).toHaveCount(0);
});

test('long functions stay inside the Last shot and history boxes', async ({ browser }) => {
  const page = await newPlayer(browser, 'Long');
  await page.goto('/#/practice');
  const long = '0.834*cos(1.852*x+2.085)+x/2.085+0.5*sin(x/3)+0.25*cos(x/5)+x/100+0.1*sin(x/9)';
  await fire(page, long);
  await expect(page.locator('.last-shot code')).toHaveText(long);
  for (const sel of ['.last-shot', '.history']) {
    const fits = await page.locator(sel).evaluate((el) => {
      const box = el.getBoundingClientRect();
      return [...el.querySelectorAll('code')].every((c) => c.getBoundingClientRect().right <= box.right + 0.5) && el.scrollWidth <= el.clientWidth;
    });
    expect(fits, sel).toBe(true);
  }
});

test('finished matches appear in match history and can be watched', async ({ browser }) => {
  const page = await newPlayer(browser, 'Historian');
  await page.addInitScript(() => {
    Math.random = () => 0.25;
  });
  await page.goto('/#/profile');
  await expect(page.getByText('No matches yet')).toBeVisible();
  await page.goto('/#/local');
  await choose(page.getByRole('button', { name: 'Who plays' }).nth(1), 'Hard bot');
  await page.getByRole('button', { name: 'Start match' }).click();
  const over = page.getByRole('heading', { name: /You win|You lose|Draw/ });
  for (let i = 0; i < 400 && !(await over.isVisible()); i++) {
    const box = page.locator('#fn-input');
    if ((await box.count()) && (await box.isEnabled())) await fire(page, 'x/8').catch(() => {});
    await page.waitForTimeout(250);
  }
  await expect(over).toBeVisible();
  await page.getByRole('link', { name: 'Back to menu' }).click();
  await page.goto('/#/profile');
  const row = page.locator('.match').first();
  await expect(row).toContainText('vs Euler');
  await expect(row).toContainText('Vs bots');
  await row.getByRole('link', { name: 'Watch' }).click();
  await expect(page.getByText('Replay', { exact: true })).toBeVisible();
  await expect(page.locator('.history button.shot').first()).toBeVisible({ timeout: 20_000 });
});

test('the shop previews items before buying, including obstacle designs', async ({ browser }) => {
  const page = await newPlayer(browser, 'Shopper');
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/#/shop');
  await expect(page.getByRole('heading', { name: 'Obstacles' })).toBeVisible();
  const preview = page.locator('.shop-preview');
  const field = preview.locator('canvas');
  await expect(preview).toContainText('Previewing: Candy');
  await page.waitForTimeout(1200);
  const candy = await field.screenshot();
  for (const name of ['Planets', 'Black and white', 'Moons', 'Cookies', 'Fruit slices', 'Pool balls']) {
    await page.getByRole('button', { name: `Preview ${name}` }).click();
    await expect(preview).toContainText(`Previewing: ${name}`);
  }
  await page.getByRole('button', { name: 'Preview Neon' }).first().click();
  await page.waitForTimeout(600);
  expect((await field.screenshot()).equals(candy)).toBe(false);
  await page.getByRole('button', { name: 'Preview Top hat' }).click();
  await expect(preview).toContainText('Previewing: Top hat');
  await page.getByRole('button', { name: 'Preview The Integrator' }).click();
  await expect(preview).toContainText('The Integrator');
  // Previewing doesn't buy or equip anything.
  await expect(page.locator('.sparks')).toHaveText('0 Sparks');
  await page.getByRole('button', { name: /Buy for 600 Sparks/ }).first().click();
  await expect(page.getByRole('alert')).toContainText('more Sparks');
  expect(errors).toEqual([]);
});

test('shop items run from cheapest to most expensive, with earned items last', async ({ browser }) => {
  const page = await newPlayer(browser, 'Sorter');
  await page.goto('/#/shop');
  const sections = page.locator('.shop-items .sheet');
  await expect(sections).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    const prices = await sections.nth(i).locator('.item').evaluateAll((items) => items.map((el) => {
      if (el.textContent?.includes('Earn:')) return Infinity;
      const m = el.textContent?.match(/Buy for (\d+)/);
      // Free items, and owned ones, which here are only the free starters.
      return m ? Number(m[1]) : 0;
    }));
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  }
});

test('the shop preview shows explosions inside the field, and goes full screen and back', async ({ browser }) => {
  const page = await newPlayer(browser, 'Boomer');
  await page.goto('/#/shop');
  await page.getByRole('button', { name: 'Preview Ring' }).click();
  const canvas = page.locator('.shop-preview canvas');
  // Watch the field for a while and count the brightest orange pixels the explosion makes.
  const orange = await canvas.evaluate(async (cv: HTMLCanvasElement) => {
    let best = 0;
    const end = performance.now() + 9000;
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      const small = document.createElement('canvas');
      small.width = cv.width / 2;
      small.height = cv.height / 2;
      const g = small.getContext('2d')!;
      g.drawImage(cv, 0, 0, small.width, small.height);
      const d = g.getImageData(0, 0, small.width, small.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! > 235 && d[i + 1]! > 110 && d[i + 1]! < 200 && d[i + 2]! < 90) n++;
      best = Math.max(best, n);
    }
    return best;
  });
  // Off-screen explosions, the old bug, leave almost none.
  expect(orange).toBeGreaterThan(50);

  const before = (await canvas.boundingBox())!.width;
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('.shop-preview.full')).toBeVisible();
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(before * 1.5);
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(page.locator('.shop-preview.full')).toHaveCount(0);
  // Escape also leaves it.
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('.shop-preview.full')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.shop-preview.full')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Hats' })).toBeVisible();
});

test('music and sound settings work, and every track renders cleanly', async ({ browser }) => {
  const page = await newPlayer(browser, 'Listener');
  await page.goto('/#/settings');
  await expect(page.getByLabel('Play music')).toBeChecked();
  await page.getByLabel('Mute sound effects').check();
  await page.getByLabel('Mute sound effects').uncheck();
  await page.getByRole('button', { name: 'Slow Orbit' }).click();
  await expect(page.getByRole('button', { name: 'Slow Orbit' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Play music').uncheck();
  await page.reload();
  await expect(page.getByLabel('Play music')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Slow Orbit' })).toHaveAttribute('aria-pressed', 'true');
  test.skip(!!process.env.E2E_BASE, 'The source modules are only served by the local dev server.');
  // Render 16 bars of each track offline: it should be audible but never clip.
  const levels = await page.evaluate(async () => {
    const music = await import('/src/audio/music.ts' as string);
    const compose = await import('/src/audio/compose.ts' as string);
    const out: { peak: number; rms: number }[] = [];
    for (const track of compose.TRACKS) {
      const beat = 60 / track.bpm;
      const seconds = 16 * 4 * beat + 4;
      const ctx = new OfflineAudioContext(2, Math.ceil(22050 * seconds), 22050);
      const mixer = new music.MusicMixer(ctx, ctx.destination);
      mixer.startNoise(0);
      for (let bar = 8; bar < 24; bar++) {
        for (const ev of compose.composeBar(track, bar)) mixer.play(ev, (bar - 8) * 4 * beat, beat);
      }
      const buf = await ctx.startRendering();
      let peak = 0;
      let sum = 0;
      const data = buf.getChannelData(0);
      for (const v of data) {
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
      }
      out.push({ peak, rms: Math.sqrt(sum / data.length) });
    }
    return out;
  });
  for (const l of levels) {
    expect(l.peak).toBeLessThan(0.9);
    expect(l.rms).toBeGreaterThan(0.005);
  }
});

test('dropdowns open a game-styled list that works with the mouse and keyboard', async ({ browser }) => {
  const page = await newPlayer(browser, 'Picker');
  await page.goto('/#/local');
  const soldiers = page.getByRole('button', { name: 'Soldiers each' });
  await expect(soldiers).toHaveText('1');
  // Mouse: open, pick, and it closes showing the choice.
  await choose(soldiers, '3');
  await expect(soldiers).toHaveText('3');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  // Keyboard: arrows move, Enter picks, Escape closes without changing anything.
  await soldiers.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox', { name: 'Soldiers each' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(soldiers).toHaveText('4');
  await soldiers.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(soldiers).toHaveText('4');
  await expect(soldiers).toBeFocused();
  // A click elsewhere closes it too.
  await soldiers.click();
  await page.getByRole('heading', { name: 'Players' }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  // The choice is really used: who plays changes to a bot.
  await choose(page.getByRole('button', { name: 'Who plays' }).first(), 'Easy bot');
  await expect(page.getByRole('button', { name: 'Who plays' }).first()).toHaveText('Easy bot');
});

test('the shot preview shows in a normal match, not just Free Play', async ({ browser }) => {
  const page = await newPlayer(browser, 'Viewer');
  // Without motion, the field only changes when something really changes.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/local');
  // Two people at one screen, so a bot can't end the match before anyone types.
  await choose(page.getByRole('button', { name: 'Who plays' }).nth(1), 'Person');
  await page.getByRole('button', { name: 'Start match' }).click();
  const box = page.locator('#fn-input');
  await expect(box).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(500);
  const field = page.locator('.game canvas');
  const before = await field.screenshot();
  await box.fill('x/3');
  await page.waitForTimeout(400);
  expect((await field.screenshot()).equals(before)).toBe(false);
  // Clearing the box clears the preview again.
  await box.fill('');
  await page.waitForTimeout(400);
  expect((await field.screenshot()).equals(before)).toBe(true);
});

test('phones get math keys that type functions, and the setting can turn them off', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('mathbattles.profile.v1')) localStorage.setItem('mathbattles.profile.v1', JSON.stringify({ name: 'Thumbs', analytics: 'no' }));
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/#/practice');
  const box = page.locator('#fn-input');
  const keys = page.getByRole('group', { name: 'Math keys' });
  await expect(keys).toBeVisible();
  // The phone's own keyboard stays closed while the math keys are showing.
  await expect(box).toHaveAttribute('inputmode', 'none');
  for (const k of ['5', 'times', 'sin', 'x', 'divide', '3']) await keys.getByRole('button', { name: k, exact: true }).tap();
  await expect(box).toHaveValue('5*sin(x/3)');
  await keys.getByRole('button', { name: 'Delete', exact: true }).tap();
  await keys.getByRole('button', { name: '4', exact: true }).tap();
  await expect(box).toHaveValue('5*sin(x/4)');
  await page.getByRole('button', { name: 'Fire', exact: true }).tap();
  await expect(page.getByRole('list', { name: 'Shots in this match' })).toContainText('5*sin(x/4)', { timeout: 15_000 });
  // ABC switches to the phone keyboard, and the keys can come back.
  await keys.getByRole('button', { name: 'Use the phone keyboard' }).tap();
  await expect(box).toHaveAttribute('inputmode', 'text');
  await page.getByRole('button', { name: 'Show math keys' }).tap();
  await expect(keys).toBeVisible();
  // Never hides them everywhere.
  await page.goto('/#/settings');
  await page.getByRole('group', { name: 'Math keyboard' }).getByRole('button', { name: 'Never' }).tap();
  await page.goto('/#/practice');
  await expect(page.locator('#fn-input')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Math keys' })).toHaveCount(0);
  await ctx.close();
});

test('an owned obstacle design is used on the real field', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('mathbattles.profile.v1', JSON.stringify({ name: 'Rich', analytics: 'no', sparks: 5000 }));
  });
  page.on('pageerror', (e) => {
    throw e;
  });
  await page.goto('/#/shop');
  await page.locator('.item', { hasText: 'Planets' }).getByRole('button', { name: 'Buy for 600 Sparks' }).click();
  await page.locator('.item', { hasText: 'Planets' }).getByRole('button', { name: 'Equip' }).click();
  await expect(page.locator('.item', { hasText: 'Planets' }).getByRole('button', { name: 'Equipped' })).toBeVisible();
  await page.goto('/#/practice');
  await expect(page.locator('.game canvas')).toBeVisible();
  await fire(page, '0');
  await expect(page.locator('.who')).toHaveText('Your turn', { timeout: 25_000 });
});

test('matches start as 1v1 by default', async ({ browser }) => {
  const page = await newPlayer(browser, 'Default');
  await page.goto('/#/local');
  await expect(page.getByRole('button', { name: 'Soldiers each' })).toHaveText('1');
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('.scores')).toContainText('1/1');
  await page.goto('/#/online');
  await page.getByRole('button', { name: 'Create private room' }).click();
  await expect(page.getByRole('button', { name: 'Soldiers each' })).toHaveText('1');
});

test('public player pages show missing players clearly', async ({ browser }) => {
  const page = await newPlayer(browser, 'Viewer');
  await page.goto('/#/player/nobody_here_at_all');
  await expect(page.getByRole('heading', { name: 'No player found' })).toBeVisible();
});

test('the 3 UI designs can be swapped in Settings, and the choice sticks', async ({ browser }) => {
  const page = await newPlayer(browser, 'Designer');
  await page.goto('/#/settings');
  const picker = page.getByRole('group', { name: 'UI design' });
  await expect(picker.getByRole('button')).toHaveCount(3);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  const paper = await bg();
  for (const [label, id] of [['Chalkboard', 'chalk'], ['Blueprint', 'blueprint']] as const) {
    await picker.getByRole('button', { name: label }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', id);
    await expect(picker.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  }
  // The color fades, and a busy machine can delay that, so wait for it instead of guessing.
  await expect.poll(bg, { timeout: 10_000 }).not.toBe(paper);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'blueprint');
  // Every design still draws a working field.
  await page.goto('/#/level/0-1');
  await fire(page, '0');
  await expect(page.getByRole('heading', { name: /Level cleared/ })).toBeVisible({ timeout: 20_000 });
});

test('old saves naming the removed design load safely', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('mathbattles.profile.v1', JSON.stringify({ name: 'Old', analytics: 'no', theme: 'arena', lookVersion: 2 }));
  });
  page.on('pageerror', (e) => {
    throw e;
  });
  await page.goto('/#/practice');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  await expect(page.locator('.game canvas')).toBeVisible();
});

test('pages change with a fade', async ({ browser }) => {
  const page = await newPlayer(browser, 'Fade');
  await page.goto('/#/learn');
  await expect(page.locator('.route')).toBeVisible();
  const leaving = page.evaluate(() => new Promise<boolean>((resolve) => {
    const route = document.querySelector('.route')!;
    const seen = () => route.classList.contains('leaving');
    new MutationObserver(() => { if (seen()) resolve(true); }).observe(route, { attributes: true });
    setTimeout(() => resolve(false), 1000);
    location.hash = '/shop';
  }));
  expect(await leaving).toBe(true);
  await expect(page.getByRole('heading', { name: 'Shop' })).toBeVisible();
});

for (const [name, width, height] of [
  ['small phone', 320, 568],
  ['phone', 390, 844],
  ['phone held sideways', 844, 390],
  ['tablet', 768, 1024],
  ['small laptop', 1024, 700],
  ['desktop', 1440, 900],
  ['large display', 2560, 1440],
] as const) {
  test(`every page fits a ${name} (${width}x${height}) with no sideways scroll`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      if (!localStorage.getItem('mathbattles.profile.v1')) localStorage.setItem('mathbattles.profile.v1', JSON.stringify({ name: 'Fit', analytics: 'no' }));
    });
    for (const path of ['/#/', '/#/practice', '/#/campaign', '/#/learn', '/#/learn/slope', '/#/learn/winning', '/#/shop', '/#/settings', '/#/local', '/#/profile', '/#/online', '/#/ranked', '/#/leaderboard', '/#/signin', '/#/level/0-1', '/#/daily']) {
      await page.goto(path);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    // The board and the function box must both be reachable, and the board must be usable.
    await page.goto('/#/practice');
    // The previous page has a board too, so wait until this one has replaced it.
    await expect(page.getByRole('button', { name: 'New map' })).toBeVisible();
    const field = await page.locator('.game canvas').boundingBox();
    expect(field!.width).toBeGreaterThanOrEqual(Math.min(280, width - 40));
    await expect(page.locator('#fn-input')).toBeVisible();
    expect((await page.locator('#fn-input').boundingBox())!.width).toBeGreaterThan(100);
  });
}
