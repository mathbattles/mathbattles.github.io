# Security

## Reporting a problem

If you find a security problem in MathBattles.io, please don't post it publicly. Open a
private report with GitHub's **Report a vulnerability** button on this repository's Security
tab. We'll reply as soon as we can.

## How the game is protected

- **Accounts.** Sign-in is handled by Firebase Authentication. Passwords never reach our server,
  except the one check that lets players sign in with a username, which is rate limited and
  never stored or logged. Login tokens are verified on every request.
- **Server.** Every result in an online match is calculated on the server, so a modified game
  can't fake shots, kills or ratings. All database queries use parameters. Write requests must be
  JSON from the game's own site. Requests are rate limited per player and per device.
- **Admin page.** Only the owner account can open it, and only with a fresh code from an
  authenticator app. The code's secret is encrypted, codes can't be reused, and admin sessions
  last 30 minutes.
- **Responses.** API answers are never cached, and carry headers that stop content sniffing and
  framing. Error logs are scrubbed of tokens, passwords, keys and email addresses.
- **The site.** A content security policy allows only the game's own scripts. Scripts and styles
  carry integrity hashes. No source maps are published. Fonts are served from this site.
- **Ids.** Party and invite ids are random UUIDs. Room and map codes are short on purpose, so
  people can type them, and give no access on their own.
- **Supply chain.** GitHub Actions are pinned to exact commits, each job has only the permissions
  it needs, installs follow the lockfile's integrity hashes, and every build fails on known
  high-severity vulnerabilities. Dependabot proposes updates weekly.
