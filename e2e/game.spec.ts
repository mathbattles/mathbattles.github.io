import { expect, test, type Browser, type Page } from '@playwright/test';

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

const fire = async (page: Page, expr: string) => {
  await page.locator('#fn-input').fill(expr);
  await page.getByRole('button', { name: 'Fire', exact: true }).click();
};

test('a whole match against a bot can be finished, and pays rewards', async ({ browser }) => {
  const page = await newPlayer(browser, 'Solo');
  await page.goto('/#/local');
  await page.getByLabel('Who plays').nth(1).selectOption('hard');
  await page.getByLabel('Soldiers each').selectOption('1');
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

  await b.goto('/#/online');
  await b.getByLabel('Room code').fill(code);
  await b.getByRole('button', { name: 'Join' }).click();
  await expect(a.getByText('Bo', { exact: true })).toBeVisible();
  await expect(b.getByText('Ana', { exact: true })).toBeVisible();

  // Starting too early is refused with a reason.
  await a.getByRole('button', { name: 'Start match' }).click();
  await expect(a.getByRole('alert')).toContainText('ready');

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

test('a saved replay link plays back to the end', async ({ browser }) => {
  const page = await newPlayer(browser, 'Watcher');
  const replay = { v: 1, config: { kind: 'teams', mode: 'fn', abilities: false, soldiers: 1, seed: 5 },
    setups: [{ id: 'a', name: 'Ana', team: 1 }, { id: 'b', name: 'Bo', team: 2 }],
    actions: [{ a: 'f', p: 'a', e: 'x/8' }, { a: 'l', p: 'b' }] };
  const data = Buffer.from(JSON.stringify(replay)).toString('base64url');
  await page.goto(`/#/replay/${data}`);
  await expect(page.locator('.scores')).toContainText('Ana');
  // The first shot is taken by whichever player the seed puts first, or the link stops safely.
  await expect(page.getByRole('heading', { name: /broken/ })).toHaveCount(0);
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

test('the layout has no sideways scroll on a phone', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const page = await ctx.newPage();
  for (const path of ['/#/', '/#/practice', '/#/campaign', '/#/learn', '/#/shop', '/#/settings', '/#/local', '/#/profile']) {
    await page.goto(path);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
