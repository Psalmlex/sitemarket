# Launch checklist

## Done in this pass
- [x] Fixed a startup crash: Express 5 rejects the bare `"*"` wildcard route used for SPA fallback.
- [x] Added `helmet` for security headers (CSP, no-sniff, etc).
- [x] Added rate limiting: 300 req/15min general API, 20 req/15min on `/auth/*` to blunt credential stuffing.
- [x] Server refuses to boot in production without `DATABASE_URL` and a real `JWT_SECRET` (no silent insecure defaults).
- [x] Fixed stored XSS: listing titles/descriptions/names are now HTML-escaped in the frontend before rendering. Previously a seller could put `<script>` in a listing title and it would execute for every visitor.
- [x] Sellers can no longer self-declare a listing as "verified" — verification is now always admin-set.
- [x] Offers now check the listing exists, is active, and that buyers can't offer on their own listing.
- [x] Added pagination to `/api/listings` (`page`, `pageSize`, capped at 48/page) so the marketplace doesn't unbounded-load as listings grow.
- [x] Added a global error handler and graceful shutdown (SIGTERM/SIGINT) so in-flight requests finish and DB connections close cleanly on redeploys.
- [x] `trust proxy` set for correct client IPs behind Render's load balancer.
- [x] **Info leak fixed**: `/api/listings/:id` used to return pending/rejected listings and the seller's raw email to any unauthenticated visitor. Now only serves active listings and drops the email field.
- [x] **Business logic gap fixed**: accepting an offer now marks the listing `sold` inside a database transaction, so buyers can't keep submitting offers on an already-agreed deal, and a failed update can't leave the listing/offer out of sync.
- [x] **Admin input validation**: status/verification updates are now checked against the allowed enum values instead of accepting anything.
- [x] **Reports** now verify the listing exists before recording a report.
- [x] **Full admin control center**: user management (change role, ban/unban), report review (resolve/dismiss), and site settings (site name, support email, commission rate, editable niche list, listing verification requirement) — all backed by a `settings` table instead of hardcoded frontend values.
- [x] Banned users are blocked at both login and on every authenticated request (a live session is invalidated immediately after a ban, not just on next login).
- [x] Admins can't demote/ban their own account (prevents accidental lockout).
- [x] Featured listings: admins can pin listings to sort first in the marketplace.
- [x] **Account lockout**: 5 failed logins locks an account for 15 minutes, independent of IP — stops distributed brute force that IP-based rate limiting alone can't catch.
- [x] **Stronger password policy**: minimum 8 characters with a letter and a number (was 6, no complexity requirement).
- [x] **User enumeration resistance**: login always runs a bcrypt comparison, even for unknown emails, so response timing doesn't reveal whether an account exists.
- [x] **JWT algorithm pinned** (`HS256` explicitly) to close off algorithm-confusion style token attacks.
- [x] **HSTS** enabled in production via helmet, forcing HTTPS on repeat visits.
- [x] Tightened request body limit from 2mb to 200kb — reduces surface for payload-based memory exhaustion.
- [x] Rate limiting added to offers, messages, and reports (30 per 10 min) to blunt spam/abuse beyond just login.

## Known, deliberately out of scope of this pass
- **CSRF**: not applicable in the classic sense — auth uses a Bearer token in `localStorage`, not cookies, so there's no ambient credential for a forged cross-site request to ride on. This is a reasonable tradeoff for now, but be aware it means any successful XSS has a larger blast radius (token theft) than a cookie-based session would.
- **Dependency CVEs**: I checked current advisories for `jsonwebtoken`, `express`, `pg`, `bcryptjs`, and `helmet` and found nothing that applies to the versions pinned in `package.json` as of this pass. This isn't a substitute for running `npm audit` yourself after `npm install`, and dependency advisories change over time — rerun it periodically, especially before any release.
- **Professional penetration testing**: nothing here replaces an actual third-party security audit. For anything handling real financial-adjacent negotiations between strangers, I'd genuinely recommend one before a public launch.
- [x] `.gitignore` added so `.env` and `node_modules` never get committed.

## You should do before real users touch this
- [ ] **Change or remove demo accounts** (`admin@sitemarket.local` etc.) — never ship default credentials to production. Update `scripts/seed.js` or skip seeding in prod entirely.
- [ ] **Set real site settings** — the admin Settings tab ships with placeholder values (site name "SiteMarket", commission rate 5%, a generic niches list). Update these to your real business figures before launch.
- [ ] **Escrow/payments**: the README already flags this — the offer flow only records deal intent, no money moves through the app. Don't imply otherwise in your marketing copy until you've integrated a compliant provider.
- [ ] **Email verification** — there currently isn't any. Anyone can register with any email. Consider adding verification before allowing offers/listings if fraud is a concern.
- [ ] **Terms of Service / Privacy Policy** — you're handling user accounts, financial figures, and deal communications; get these reviewed by a lawyer before launch, especially given you're facilitating business sale negotiations.
- [ ] **Backups** — enable automated backups on your Postgres instance (Render does this on paid plans; confirm your tier).
- [ ] **Monitoring** — hook up an uptime check on `/api/health` and error alerting (e.g. Sentry) so you know when something breaks in production, not from a user complaint.
- [ ] **Image support** — listings currently have no images. For a marketplace this is a significant trust/conversion gap; consider adding upload support (e.g. S3-compatible storage) before a public launch.
- [ ] **Load test** the `/api/listings` search before high traffic — it's `ILIKE`-based, which won't scale past a few thousand listings. A Postgres full-text index (`tsvector`) is the natural upgrade.

## Deploying to Render
1. Push this repo to GitHub/GitLab.
2. In Render, create a new Blueprint from `render.yaml` (or a Web Service + PostgreSQL manually).
3. Render will generate `JWT_SECRET` and wire `DATABASE_URL` automatically per `render.yaml`.
4. After first deploy, run `npm run db:init` and `npm run seed` against the production database via Render's shell — **only if you're comfortable with the demo accounts existing in production**, otherwise seed your own admin manually.
5. Verify `https://<your-app>.onrender.com/api/health` returns `{"ok":true}`.

## Upgrading an existing database
If you already ran `db:init` before this update, the new columns (`users.banned`, `listings.featured`, `reports.resolved_by`/`resolved_at`) and the `settings` table won't exist yet. `db/schema.sql` uses `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`, so simply re-running `npm run db:init` against the same database applies the migration safely without touching existing data.
