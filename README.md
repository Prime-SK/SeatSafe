# SeatSafe

A workshop reservation project built step by step with Angular, NestJS, and PostgreSQL.

Start with the [documentation index](docs/README.md), [implementation plan](docs/implementation-plan.md), and [Phase 12 protected endpoints guide](docs/phases/phase-12-protected-endpoints.md). Its authentication prerequisites are [Phase 11 login](docs/phases/phase-11-jwt-login.md) and [Phase 10 registration](docs/phases/phase-10-registration.md). Configuration and connection are explained in [Phase 5](docs/phases/phase-05-configuration.md) and [Phase 6](docs/phases/phase-06-postgresql.md); table creation and seeding are explained in [Phase 7](docs/phases/phase-07-workshop-data.md), and repository reads in [Phase 8](docs/phases/phase-08-workshop-reads.md).

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

From `api/`, after runtime activation, use `npm run db:migration:show` to inspect status and `npm run db:migration:run` to apply pending migrations. Each builds first and uses the compiled DataSource. The workshop, users and auth_sessions migrations are already applied on this computer. Automatic schema synchronization and automatic startup migration execution are disabled. `npm run db:migration:revert` now drops the latest auth_sessions table and its sessions; reversal is demonstrated only inside isolated database tests.

Run `npm run db:seed` after migrations to insert the three development workshops. It builds first, requires development mode, and preserves existing IDs without resetting their data. It has already inserted all three records here; a repeat reports `0 inserted, 3 skipped`. No provisioning or seed runs automatically at API startup.

Backend verification: `npm run build`, `npx tsc --noEmit`, `npm run lint`, `npx prettier --check src test vitest.config.database.ts`, `npm test`, `npm run test:e2e`, and `npm run test:db`. Unit/HTTP tests use controlled providers without private credentials. The explicit database suites require seatsafe_dev and use disposable random schemas with public signing fixtures. Their 56 cases retain 18 workshop persistence, nine workshop HTTP, nine registration and 11 login/session cases, plus nine protected-account cases. No development tables are truncated or reverted.

Workshop routes return exactly seven fields: id, title, capacity, reservedSeats, registrationOpen, availableSeats and startsAt (ISO UTC). Audit timestamps remain private. Angular formats dates in Asia/Colombo with a visible Sri Lanka time label. Stored dates and workshop rows are unchanged; existing availability remains 20/10/12.

Phase 10 adds `POST /api/auth/register` and Angular `/register`. The typed form checks confirmation locally. Nest validates/normalizes name and email, preserves passwords, hashes with Argon2id, and inserts an enabled USER protected by the database email uniqueness constraint. Success returns only id, displayName, email and role. It does not sign in. Registration and login each have an independent five-attempt/minute/IP limit. Swagger documents registration's safe 400/409/429/500/503 errors.

Phase 11 adds `POST /api/auth/login` through Swagger: email normalization, exact Argon2id password verification and a locked account recheck. Success creates an independent seven-day session and returns a signed 15-minute JWT plus a safe account summary, with Cache-Control: no-store and no cookie. Unknown, incorrect and disabled credentials share a safe 401. Token/session identifiers link the JWT to its row.

Phase 12 adds protected `GET /api/auth/me`. Exactly one Bearer header supplies a verified HS256 token; a joined PostgreSQL query checks the current account and matching session. Disabled accounts and missing/revoked/expired sessions receive uniform 401 UNAUTHORIZED with WWW-Authenticate: Bearer. Database query failures receive safe 503 DATABASE_UNAVAILABLE. Success returns exactly id, displayName, email and role; all handled responses use no-store and perform no writes. Use Swagger's Authorize control with only the login accessToken, then execute /me. Reload clears authorization. Other current routes stay public; refresh/logout, Angular login and role permissions remain later work.

PrimeNG 22 supplies Aura components with a green accent. Use PrimeNG components or directives wherever applicable to visual controls; keep native HTML for semantics and CSS for layout. Registration uses PrimeNG labels above full-width inputs, error styling, messages and buttons. Its free Community option requires a key, as the [installation](https://primeng.dev/installation) and [configuration](https://primeng.dev/configuration) pages explain. Your local key is configured through the ignored JSON asset, and you confirmed the notice is gone. For setup elsewhere, follow the [guide's local JSON setup](docs/phases/phase-10-registration.md#free-community-licence-configuration). Never put the key in source, chat or Git.

Frontend checks from web: `npm run build`, `npm test -- --watch=false`, and `npx prettier --check src/app src/main.ts src/styles.css`. The production initial bundle remains below the existing 500 kB warning budget through lazy page routes. PrimeNG handles component appearance; CSS retains responsive page layout.

The Phase 10 follow-up passed these checks: 32 frontend tests, formatting, and a production initial bundle of 469.09 kB. Registration, catalogue and details were visually verified at actual widths 1280px, 390px and 320px without horizontal overflow. Registration state checks used a mock with no database access. Backend test counts remain from the original implementation; no development data or Git operations were changed.

Phase 11 verification passed: backend build/lint/formatting and 185 tests (49 unit, 57 mocked HTTP, 47 PostgreSQL, 32 frontend). Isolated Swagger registration/login returned 201/200; wrong-password feedback returned 401. The session migration was explicitly applied after checks; full development user/workshop snapshots were unchanged. Zero development accounts/sessions and availability 20/10/12 remain. The local secret was preserved or appended privately; the licence configuration was unchanged. Frontend layout evidence remains from Phase 10.

Phase 12 verification newly passed backend build, strict type checking, lint, formatting and 227 tests (51 unit, 88 HTTP, 56 PostgreSQL, 32 frontend). Isolated Swagger verified unauthorized 401, login 200, authorized /me 200 and authorization cleared after reload. The demo server/schema were removed; complete development data/migration snapshots and private configuration fingerprints were unchanged. No dependencies or development migrations were needed. Phase 11's 185 tests and Phase 10's visual results above remain historical.

Read [the Phase 12 guide](docs/phases/phase-12-protected-endpoints.md), [checkpoint with 20 questions and answers](docs/phases/phase-12-checkpoint.md), and [saved plan](docs/phases/phase-12-plan.md). Implementation stops for learning review; Phase 10 and 11 reviews remain pending too. Phase 13 refresh tokens have not started. Angular login/authentication state remain Phases 15–16. Bookings remain later phases. Git stays yours to manage.
