# Tianrui Li — personal site

Public site: https://tianruili.pages.dev/
Private inbox: https://tianruili.pages.dev/admin/

The existing static portfolio remains at the repository root. `intro-audio.js` restores the original synthesized mechanical keyboard sounds. `signal.js` submits private messages; it only clears the draft after the server confirms receipt.

## Inbox

Cloudflare Pages runs `backend/worker.mjs` with the D1 binding in `wrangler.toml`. Messages are never public. The owner enters through a private management link; no password is needed. Its secret fragment is removed from browser history immediately and exchanged for a random, HttpOnly, Secure, SameSite cookie. Only session hashes are stored in D1. Authorized browsers stay signed in for 90 days; regular visits renew that period. Existing authorized sessions continue working. The server checks request origins and applies submission/access limits. Archive actions are reversible.

`ADMIN_SECRET` must be configured as a Cloudflare Pages production secret; never put it in this repository. Preview deployments have no binding to the production inbox. The private access token is derived from that secret with a distinct HMAC purpose. Anyone with the private link can authorize a browser, so never publish or commit that link. Logout revokes the current browser session; the private link can authorize it again. Changing the server secret rotates the access link; revoke sessions separately if needed. Legacy password hashes, if present from the first release, are no longer used and no password endpoints remain.

## Validate and publish

```powershell
node --test tests/worker.test.mjs
node scripts/build.mjs
$env:CLOUDFLARE_ACCOUNT_ID = '77a859f9e286057b0b05c313e306207a'
npx --yes wrangler@4.166.0 pages deploy dist --project-name tianruili --branch main
```

Commit and push the exact source being published. The build copies only public assets and the worker into `dist`. It excludes tests, database files, configuration, and development tools. Pushing GitHub updates the additional static mirror; it does not deploy Cloudflare. The mirror sends messages to the primary site and redirects its admin page there.

The initial production schema is `backend/schema.sql`. Schema updates must preserve existing messages; use additive migrations. Normal content updates do not require running SQL.

## Local preview

```powershell
node scripts/build.mjs
npx --yes wrangler@4.166.0 d1 execute DB --local --config tests/wrangler.toml --file backend/schema.sql
Set-Location tests
npx --yes wrangler@4.166.0 pages dev --port 8788 --binding ADMIN_SECRET=local-preview-only-not-production
```

The test configuration and local D1 data are separate from production. Browser autoplay rules may delay the opening's keyboard audio until the first click or tap; sounds are not queued while blocked. There is no background music. Custom keyboard shortcuts have been removed; opening controls use clicks or taps, and native button and input behavior is preserved.
