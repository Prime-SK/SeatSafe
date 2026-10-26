# SeatSafe

A workshop reservation project built step by step with Angular, NestJS, and PostgreSQL.

Phase 18 workshop administration API is implemented: [guide](docs/phases/phase-18-workshop-administration.md), [saved plan](docs/phases/phase-18-plan.md) and [20-question checkpoint](docs/phases/phase-18-checkpoint.md). Administrators can create/edit workshops and open/close registration through Swagger, with locked capacity/date checks and unchanged public responses. New verification passed 512 tests. Learning review remains pending; Phase 19 has not started. Thirteen numbered phases remain (19–31), not an effort percentage. Booking lists are deferred to Phase 21 alongside booking storage.

The [Phase 15 redesign guide](docs/phases/phase-15-ui-ux-redesign.md) explains the shared PrimeNG Aura/green UI. Actual 200% zoom and OS reduced-motion verification remain manual checks.

Start with the [documentation index](docs/README.md), [implementation plan](docs/implementation-plan.md), and [Phase 18 workshop administration guide](docs/phases/phase-18-workshop-administration.md). Browser sign-in restoration, guarded Account reads and coordinated refresh/logout are explained in [Phase 16](docs/phases/phase-16-browser-sessions.md). Its Angular prerequisite is [Phase 15 login](docs/phases/phase-15-angular-login.md); backend prerequisites are [Phase 11 login](docs/phases/phase-11-jwt-login.md) and [Phase 10 registration](docs/phases/phase-10-registration.md). Configuration and connection are explained in [Phase 5](docs/phases/phase-05-configuration.md) and [Phase 6](docs/phases/phase-06-postgresql.md); table creation and seeding are explained in [Phase 7](docs/phases/phase-07-workshop-data.md), and repository reads in [Phase 8](docs/phases/phase-08-workshop-reads.md).

## Run SeatSafe locally

PostgreSQL must be running, and the backend needs valid database settings in ignored `api/.env`. The dedicated `seatsafe_dev` database and `seatsafe_app` login are already provisioned on this computer. For first-time setup elsewhere, follow the Phase 6 guide and run `scripts/setup-database.ps1` in PowerShell 7; enter the administrator password only in its local prompt. Do not rerun provisioning for ordinary development or overwrite the generated `.env`.

Open two PowerShell terminals. Run these commands in the first:

```powershell
Set-Location 'D:\Projects\SeatSafe'
. .\scripts\use-node.ps1
Set-Location api
npm run start:dev
```

In the second:

```powershell
Set-Location 'D:\Projects\SeatSafe'
. .\scripts\use-node.ps1
Set-Location web
npm start
```

Open the [workshop catalogue](http://localhost:4200/workshops); the root redirects there. Follow a workshop title to its details, use Back to workshops, or refresh a detail URL directly. `/workshops/unknown` displays Workshop not found; unmatched frontend URLs display a page-not-found screen. The backend starter lives at [localhost:3000/api](http://localhost:3000/api).

Angular's development server forwards `/api/**` to Nest at port 3000 without rewriting the path. Browser code uses relative URLs. If Nest uses another port, update `web/src/proxy.conf.json` and restart Angular. Production serving remains later work.

The workshop API supports:

- [List workshops](http://localhost:3000/api/workshops).
- [View a workshop](http://localhost:3000/api/workshops/workshop-1).
- [Try a missing workshop](http://localhost:3000/api/workshops/unknown), which returns HTTP 404.

[Database health](http://localhost:3000/api/health) returns HTTP 200 with `{"status":"ok","database":"up"}` when its query succeeds. A later database failure produces standard HTTP 503 with `Database unavailable`. If the initial connection fails after three attempts, the backend exits before listening.

Open [Swagger UI](http://localhost:3000/swagger) to see all current endpoints and test them with **Try it out → Execute**. For workshop detail, enter `workshop-1` or `unknown` in the `id` field. The machine-readable API document is at [swagger-json](http://localhost:3000/swagger-json). Use your configured API port if different from 3000. Swagger is served by the backend; Angular does not need to run for it.

Stop each server with Ctrl+C. The backend validates local settings through ConfigModule; process environment settings override matching `.env` keys. PORT defaults to 3000, but database name, login, password and JWT_SECRET are required for application startup. The signing secret needs at least 32 UTF-8 bytes; use a securely generated random value. It is configured locally without displaying it. `.env.example` contains blank password/signing placeholders and cannot run as-is. Follow the Phase 11 guide for a new setup; preserve the existing private `.env`. Migration commands require database settings independently of JWT.

The runtime helper selects compatible Node 24 and project-local npm for that terminal only. See the Phase 1 guide for setup on another computer and dependency installation.

From `api/`, after runtime activation, use `npm run db:migration:show` to inspect status and `npm run db:migration:run` to apply pending migrations. Each builds first and uses the compiled DataSource. The workshop, users, auth_sessions and auth_refresh_tokens migrations are already applied on this computer. Automatic schema synchronization and automatic startup migration execution are disabled. `npm run db:migration:revert` now drops the latest auth_refresh_tokens table and its credentials; reversal is demonstrated only inside isolated database tests.

Run `npm run db:seed` after migrations to insert the three development workshops. It builds first, requires development mode, and preserves existing IDs without resetting their data. It has already inserted all three records here; a repeat reports `0 inserted, 3 skipped`. No provisioning or seed runs automatically at API startup.

To deliberately create your initial development administrator, run `npm run db:seed:admin` from api in an interactive terminal. Enter name/email and a hidden password with confirmation; no password arguments or new credential file are accepted. It requires applied migrations, reuses registration validation/Argon2id and creates an enabled ADMIN. An existing enabled ADMIN is skipped unchanged; USER or disabled accounts cause a safe conflict without updates. No actual development administrator was created during Phase 17. See the guide before running it.

`GET /api/admin/access` authenticates through Bearer and the current database session, then requires the current ADMIN role. It returns exactly `{ "authorized": true }`; authenticated USER receives safe 403 FORBIDDEN. Authentication failures remain 401, database failures 503, and handled responses use no-store. Swagger documents the endpoint. Administrator UI remains later work; workshop editing is described below. Historical Phase 17 checks passed 121 unit, 129 HTTP, 98 PostgreSQL and 94 frontend tests (442 total); backend build, strict types, lint and formatting passed. Development rows/private configuration were preserved and disposable schemas removed.

`POST /api/admin/workshops` now creates a workshop (201), and `PATCH /api/admin/workshops/:id` edits supplied fields (200). Both require current ADMIN permission and return the existing seven-field workshop representation. Requests accept title, capacity, startsAt and registrationOpen only; creation defaults registration to open, while PATCH preserves omitted values. Updates lock the current workshop, protect reserved capacity and enforce future rescheduling/opening. Public reads show committed changes. New Phase 18 checks passed 137 unit, 170 HTTP, 111 PostgreSQL and 94 frontend tests (512 total), plus backend build, strict types, lint and formatting. Isolated Swagger demonstrated create/edit/close/reopen and USER denial; development/private fingerprints matched and disposable schemas were removed. No development administrator was created. Administrator UI remains Phase 19.

Backend verification: `npm run build`, `npx tsc --noEmit`, `npm run lint`, `npx prettier --check src test vitest.config.database.ts`, `npm test`, `npm run test:e2e`, and `npm run test:db`. Unit/HTTP tests use controlled providers without private credentials. The explicit database suites require seatsafe_dev and use disposable random schemas with public signing fixtures. Their 111 cases retain the prior 98 persistence/authentication/administrator cases and add 13 workshop-administration cases with real row locks and rollback. No development tables are truncated or reverted.

Workshop routes return exactly seven fields: id, title, capacity, reservedSeats, registrationOpen, availableSeats and startsAt (ISO UTC). Audit timestamps remain private. Angular formats dates in Asia/Colombo with a visible Sri Lanka time label. Stored dates and workshop rows are unchanged; existing availability remains 20/10/12.

Phase 10 adds `POST /api/auth/register` and Angular `/register`. The typed form checks confirmation locally. Nest validates/normalizes name and email, preserves passwords, hashes with Argon2id, and inserts an enabled USER protected by the database email uniqueness constraint. Success returns only id, displayName, email and role. It does not sign in. Registration and login each have an independent five-attempt/minute/IP limit. Swagger documents registration's safe 400/409/429/500/503 errors.

Phase 11 adds `POST /api/auth/login` through Swagger: email normalization, exact Argon2id password verification and a locked account recheck. Success creates an independent seven-day session and returns a signed 15-minute JWT plus a safe account summary, with Cache-Control: no-store. Phase 13 adds its HttpOnly refresh cookie. Unknown, incorrect and disabled credentials share a safe 401. Token/session identifiers link the JWT to its row.

Phase 12 adds protected `GET /api/auth/me`. Exactly one Bearer header supplies a verified HS256 token; a joined PostgreSQL query checks the current account and matching session. Disabled accounts and missing/revoked/expired sessions receive uniform 401 UNAUTHORIZED with WWW-Authenticate: Bearer. Database query failures receive safe 503 DATABASE_UNAVAILABLE. Success returns exactly id, displayName, email and role; all handled responses use no-store and perform no writes. Use Swagger's Authorize control with only the login accessToken, then execute /me. Reload clears authorization. Workshop, health, registration and login routes remain public; refresh uses its HttpOnly cookie, while logout optionally uses that cookie. Angular login is available at /login; browser session restoration is implemented, and Phase 17 adds administrator role authorization. Workshop management remains later work.

PrimeNG 22 supplies Aura components with a green accent. Use PrimeNG components or directives wherever applicable to visual controls; keep native HTML for semantics and CSS for layout. Registration uses PrimeNG labels above full-width inputs, error styling, messages and buttons. Its free Community option requires a key, as the [installation](https://primeng.dev/installation) and [configuration](https://primeng.dev/configuration) pages explain. Your local key is configured through the ignored JSON asset, and you confirmed the notice is gone. For setup elsewhere, follow the [guide's local JSON setup](docs/phases/phase-10-registration.md#free-community-licence-configuration). Never put the key in source, chat or Git.

Frontend checks from web: `npm run build`, `npm test -- --watch=false`, and `npx prettier --check src/app src/main.ts src/styles.css`. The production initial bundle remains below the existing 500 kB warning budget through lazy page routes. PrimeNG handles component appearance; CSS retains responsive page layout.

The Phase 10 follow-up passed these checks: 32 frontend tests, formatting, and a production initial bundle of 469.09 kB. Registration, catalogue and details were visually verified at actual widths 1280px, 390px and 320px without horizontal overflow. Registration state checks used a mock with no database access. Backend test counts remain from the original implementation; no development data or Git operations were changed.

Phase 11 verification passed: backend build/lint/formatting and 185 tests (49 unit, 57 mocked HTTP, 47 PostgreSQL, 32 frontend). Isolated Swagger registration/login returned 201/200; wrong-password feedback returned 401. The session migration was explicitly applied after checks; full development user/workshop snapshots were unchanged. Zero development accounts/sessions and availability 20/10/12 remain. The local secret was preserved or appended privately; the licence configuration was unchanged. Frontend layout evidence remains from Phase 10.

Phase 12 verification newly passed backend build, strict type checking, lint, formatting and 227 tests (51 unit, 88 HTTP, 56 PostgreSQL, 32 frontend). Isolated Swagger verified unauthorized 401, login 200, authorized /me 200 and authorization cleared after reload. The demo server/schema were removed; complete development data/migration snapshots and private configuration fingerprints were unchanged. No dependencies or development migrations were needed. Phase 11's 185 tests and Phase 10's visual results above remain historical.

Read [the Phase 15 guide](docs/phases/phase-15-angular-login.md), [checkpoint with 20 questions and answers](docs/phases/phase-15-checkpoint.md), and [saved plan](docs/phases/phase-15-plan.md). Implementation stops for learning review; Phase 10–14 reviews remain pending too. Phase 16 browser session handling has not started. Bookings remain later phases. Git stays yours to manage.

Phase 13 now issues refresh credentials on login: 32 random bytes, SHA-256 hash-only PostgreSQL storage and a seatsafe_refresh cookie (HttpOnly, SameSite=Lax, Path=/api/auth, host-only, Secure in production). Session and credential inserts commit together before cookie issuance. Login JSON remains unchanged; failed requests do not change existing cookies. Phase 14 now accepts this cookie for refresh/logout; /me still requires Bearer.

Login now requires an allowed Origin, falling back to Referer only when Origin is absent. AUTH_ALLOWED_ORIGINS defaults in development to http://localhost:4200 and http://localhost at the configured API port; production requires explicit HTTPS origins. Use the same hostname consistently. Command-line login must include an allowed Origin header. Rejection returns safe 403 ORIGIN_NOT_ALLOWED with no-store. This setting is application-only; migration commands remain independent. Existing private .env needs no change for local defaults.

Phase 13 newly passed backend build, strict types, lint, formatting and 265 tests (66 unit, 103 HTTP, 64 PostgreSQL, 32 frontend). Isolated Swagger login stored a browser cookie matching the database hash; Bearer /me returned 200 and cookie-only /me returned 401. The temporary server/schema were removed. The fourth additive migration applied with complete existing development rows unchanged, zero refresh credentials and no pending migrations. Private API/PrimeNG configuration was unchanged. No dependencies or Git operations were needed; Phase 12 results above remain historical.

Phase 14 adds POST /api/auth/refresh and /api/auth/logout. Refresh consumes the current hash, inserts a replacement and signs an access token in one transaction; response/cookie issuance follows commit. User → session → credential locks serialize lifecycle operations. A known consumed credential revokes its session before 401; strict simultaneous reuse also invalidates the winner's successor. Session expiry stays fixed at seven days, and the current database profile is returned.

Logout uses the refresh cookie without requiring a Bearer token, returns idempotent 204 and clears the matching cookie after commit. It revokes only that linked session, including via a consumed credential. Missing/invalid/unknown logout credentials still produce 204. Both endpoints reuse origin restrictions and have independent five-attempt/minute/IP limits. All handled outcomes use no-store; refresh 401 clears the cookie, while 403/429/500/503 retain it. Existing /me rejects revoked sessions on subsequent requests.

Phase 14 newly passed backend build, strict types, lint, formatting and 317 tests (83 unit, 122 HTTP, 80 PostgreSQL, 32 frontend). Isolated Swagger demonstrated login 200 → refresh 200 → /me 200 → logout 204 → /me 401. The demo server/schema were removed and full development data/migration history and private configuration were unchanged. No dependency, migration, Angular feature or Git operation was needed. Previous Phase 13 results above remain historical; stop for Phase 14 learning review.

Phase 15 adds Angular /login with PrimeNG fields/messages/buttons, typed reactive validation and safe errors. Email normalizes; passwords remain exact and login accepts 1–128 Unicode characters. Pending controls prevent duplicate requests, navigation cancels the subscription, and success/destruction clears the password. Registration links to sign-in while retaining its separate account-creation behavior.

Successful login navigates to /workshops and updates the header with the account name. Access tokens remain private in a root in-memory signal; no persistent browser storage or token display is added. Local expiry is conservatively based on request start plus expiresIn, and reload begins anonymous locally. Automatic refresh, refresh-on-reload, Bearer interception, logout UI, route guards and browser coordination remain Phase 16. The backend still enforces all actual access decisions.

Phase 15 newly passed 55 frontend, 83 backend unit and 122 HTTP tests (260 rerun), frontend production build and formatting. Its 487.23 kB initial bundle stays below the unchanged 500 kB warning budget. Phase 14's 80 PostgreSQL cases remain historical and were not rerun. Actual 1280px/390px/320px layouts passed overflow checks, including long account names, error wrapping, pending controls and keyboard focus. Real login through an isolated API/proxy reached the catalogue; Back showed signed-in status and reload reset local state. Temporary resources were removed with full development data and private API/PrimeNG configuration unchanged.

The roadmap is implemented through Phase 15, leaving 16 phases. Browser session handling, roles/admin features, transactional bookings/idempotency/cancellation, user administration, reliability/browser checks, packaging/deployment and interview evidence remain. This is phase progress, not an effort percentage. No dependencies, backend source/API changes, migrations or Git operations were needed. Stop for Phase 15 learning review.
