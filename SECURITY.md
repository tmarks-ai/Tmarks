# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities. Report them
privately via the GitHub Security Advisory flow (Security → Report a
vulnerability) on the project repository. If the repository you cloned has no
Security tab (a private fork or a self-hosted copy), there is no upstream
channel to contact: route the report to whoever operates that deployment
(for a self-hosted instance, that is you), then evaluate whether the upstream
project is affected too.

We will acknowledge receipt, confirm the issue, and aim to ship a fix with a
coordinated disclosure. Include as much context as you can: affected endpoint
or component, steps to reproduce, and potential impact.

## Security model

TMarks is a self-hostable bookmark and tab-group manager. This document
summarizes the design so auditors and self-hosters know what is protected and
what is a documented trade-off.

- **Authentication is split by client.** The web app logs in with a password
  and gets a short-lived JWT access token (session-bound, revocable). The
  browser extension authenticates with a scoped `X-API-Key`. The two
  credential systems are independent (schema in `sql/`).
- **Refresh tokens are HttpOnly cookies.** The web refresh token travels only
  as an `HttpOnly; SameSite=Lax` cookie (`tmarks_rt`) and is never exposed to
  JavaScript. Rotation is per-use, and presenting an already-rotated token
  revokes the whole session and is logged as a reuse event.
- **Fail-closed startup.** The worker refuses to serve (503) until D1
  migrations are applied and `JWT_SECRET` is at least 32 characters.
- **Rate limiting.** Login is limited per IP and per account, registration,
  the public share endpoint and public asset reads are limited per IP and
  globally, the server-side URL-metadata fetch is limited per user, and the
  limits fail closed on those endpoints.
- **Passwords** are hashed with PBKDF2-HMAC-SHA256 (random salt, constant-time
  comparison). New hashes use 100,000 iterations — the Cloudflare Workers
  runtime hard-caps PBKDF2 at 100,000 iterations, so that is the production
  default; `PBKDF2_ITERATIONS` can raise it (clamped to [100k, 2M]) on runtimes
  without the cap. Passwords are 8–128 characters; stored hashes embed their
  iteration count, so older hashes still verify and are upgraded on next
  password change.
- **Public share pages** are protected by an unguessable slug (95+ bits when
  auto-generated). Custom slugs must be at least 8 characters; even so, custom
  slugs are user-chosen identifiers and should be treated as public. Share
  pages only expose non-private bookmarks.
- **Snapshots** are served with a restrictive CSP and rendered inside a
  sandboxed iframe (`sandbox=""`, no scripts, opaque origin). Snapshot HTML is
  sanitized at capture time (script/noscript/iframe/object/embed/style removed,
  URL attributes protocol-whitelisted).
- **Outbound fetches are SSRF-guarded.** Server-side metadata fetches and
  favicon/cover persistence only reach public http(s) hosts: IP literals in
  private/reserved ranges (loopback, RFC1918, link-local incl. cloud metadata,
  CGNAT, multicast) and `localhost` names are refused, and redirects are
  followed manually so every hop is re-validated
  (`lib/net/public-url.ts`). A *domain name* that resolves to an internal
  address cannot be detected at the code level (the runtime offers no custom
  DNS resolution); on Cloudflare the platform blocks internal egress —
  self-hosters should restrict egress at the network layer.

## Known trade-offs

- The extension requires broad host permissions (`<all_urls>`) because it
  collects open tabs and captures page snapshots on demand. Web pages cannot
  talk to the extension: the page bridge is injected only into tabs on the
  configured API origin (the web app's own host), and the background
  re-validates the sender's origin before serving the two bridged messages.
- AI provider API keys and the extension's TMarks API key are stored in
  `chrome.storage.local` in plaintext so a self-hosted user can keep a
  connection across browser restarts. They are not encrypted by TMarks and are
  readable by the extension context and code running in the browser profile;
  users must not use the extension on shared or untrusted devices. The
  extension UI provides an explicit credential view/clear operation. Older
  session-only records are migrated into local storage for compatibility.
- Self-hosted deployments behind a proxy without Cloudflare rely on the first
  `X-Forwarded-For` hop for per-IP rate limits; per-account limits still
  apply on login. Configure your proxy to set that header correctly.
- Remote images inside bookmark snapshots are loaded when the snapshot is
  viewed (the sandbox makes them cookie-less and script-less, but the view is
  observable to the image host). Card favicons and covers likewise load
  remote images.

## Reporting scope

Please include findings in any part of the repository: worker backend
(`packages/backend-core`, `apps/worker`), web app (`apps/web`), browser
extension (`apps/tab`), or the landing page (`landing`).