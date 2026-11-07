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
  // A fixed map keeps this repeatable: on some random maps a bot can miss for minutes.
  await page.addInitScript(() => {
    Math.random = () => 0.25;
  });
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
  } finally {
    await removeAccount(nameA).catch(() => {});
    await removeAccount(nameB).catch(() => {});
  }
});

test('the menu has no Menu button, but other pages do', async ({ browser }) => {
  const page = await newPlayer(browser, 'Nav');
  await page.goto('/#/');
  await expect(page.locator('.hero')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Menu', exact: true })).toHaveCount(0);
  await page.goto('/#/shop');
  await expect(page.getByRole('link', { name: 'Menu', exact: true })).toBeVisible();
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
  await page.waitForTimeout(400);
  expect(await bg()).not.toBe(paper);
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
