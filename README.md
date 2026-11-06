# MathBattles.io

Type a function and your shot follows its graph. A free multiplayer math artillery game in the browser.

Play at https://mathbattles.github.io

## Project layout

- `packages/sim`: game rules with no browser code, shared by the client and server
- `apps/client`: the website (Vite, Preact, Canvas)
- `apps/server`: online rooms, ranked, and leaderboards (Cloudflare Workers, Durable Objects, D1)
- `e2e`: browser tests

## Commands

```bash
npm install
npm run dev          # website at localhost:5173
npm run dev:server   # game server at localhost:8787
npm test             # rules and server tests
npm run e2e          # browser tests
npm run typecheck
npm run build
```

First-time local server setup:

```bash
npm run migrate:local -w @mathbattles/server
```

## Deploying

Pushing to `main` runs the tests and publishes the site to GitHub Pages.

The server deploys separately:

```bash
cd apps/server
npx wrangler login
npx wrangler d1 create mathbattles   # put the id in wrangler.toml
npm run migrate:remote
npm run deploy
```

Put the deployed URL in `PROD_SERVER` in `apps/client/src/net/api.ts`.

## Credit

Inspired by [Graphwar](https://www.graphwar.com) and Math Wars on Roblox. Not affiliated with either. All code and art here are original.
