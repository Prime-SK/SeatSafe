# SeatSafe

A workshop reservation project built step by step with Angular, NestJS, and PostgreSQL.

Start with the [documentation index](docs/README.md), [implementation plan](docs/implementation-plan.md), and [Phase 10 registration, dates and PrimeNG guide](docs/phases/phase-10-registration.md). Configuration and connection are explained in [Phase 5](docs/phases/phase-05-configuration.md) and [Phase 6](docs/phases/phase-06-postgresql.md); table creation and seeding are explained in [Phase 7](docs/phases/phase-07-workshop-data.md), and repository reads in [Phase 8](docs/phases/phase-08-workshop-reads.md).

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

Stop each server with Ctrl+C. The backend validates local settings through ConfigModule; process environment settings override matching `.env` keys. PORT defaults to 3000, but database name, login, and password are required. `.env.example` contains a blank password placeholder and cannot connect as-is. Never share the private `.env`.

The runtime helper selects compatible Node 24 and project-local npm for that terminal only. See the Phase 1 guide for setup on another computer and dependency installation.

From `api/`, after runtime activation, use `npm run db:migration:show` to inspect status and `npm run db:migration:run` to apply pending migrations. Each builds first and uses the compiled DataSource. The workshop and users migrations are already applied on this computer. Automatic schema synchronization and automatic startup migration execution are disabled. `npm run db:migration:revert` now drops the latest users table and its accounts; reversal is demonstrated only inside the isolated database tests.

Run `npm run db:seed` after migrations to insert the three development workshops. It builds first, requires development mode, and preserves existing IDs without resetting their data. It has already inserted all three records here; a repeat reports `0 inserted, 3 skipped`. No provisioning or seed runs automatically at API startup.

Backend verification: `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`, and `npm run test:db`. Unit/HTTP tests use controlled providers without private credentials. The explicit database suites require seatsafe_dev and use disposable random schemas. They preserve all 18 workshop persistence and nine workshop HTTP cases and add nine registration cases. No development tables are truncated or reverted.

Workshop routes return exactly seven fields: id, title, capacity, reservedSeats, registrationOpen, availableSeats and startsAt (ISO UTC). Audit timestamps remain private. Angular formats dates in Asia/Colombo with a visible Sri Lanka time label. Stored dates and workshop rows are unchanged; existing availability remains 20/10/12.

Phase 10 adds `POST /api/auth/register` and Angular `/register`. The typed form checks confirmation locally. Nest validates/normalizes name and email, preserves passwords, hashes with Argon2id, and inserts an enabled USER protected by the database email uniqueness constraint. Success returns only id, displayName, email and role. It does not sign in. Registration alone is limited to five attempts per minute per request IP. Swagger documents its safe 400/409/429/500/503 errors.

PrimeNG 22 supplies Aura components with a green accent. Use PrimeNG components or directives wherever applicable to visual controls; keep native HTML for semantics and CSS for layout. Registration uses PrimeNG labels above full-width inputs, error styling, messages and buttons. Its free Community option requires a key, as the [installation](https://primeng.dev/installation) and [configuration](https://primeng.dev/configuration) pages explain. Your local key is configured through the ignored JSON asset, and you confirmed the notice is gone. For setup elsewhere, follow the [guide's local JSON setup](docs/phases/phase-10-registration.md#free-community-licence-configuration). Never put the key in source, chat or Git.

Frontend checks from web: `npm run build`, `npm test -- --watch=false`, and `npx prettier --check src/app src/main.ts src/styles.css`. The production initial bundle remains below the existing 500 kB warning budget through lazy page routes. PrimeNG handles component appearance; CSS retains responsive page layout.

The Phase 10 follow-up passed these checks: 32 frontend tests, formatting, and a production initial bundle of 469.09 kB. Registration, catalogue and details were visually verified at actual widths 1280px, 390px and 320px without horizontal overflow. Registration state checks used a mock with no database access. Backend test counts remain from the original implementation; no development data or Git operations were changed.

Read [the Phase 10 guide](docs/phases/phase-10-registration.md), [checkpoint with 20 questions and answers](docs/phases/phase-10-checkpoint.md), [original plan](docs/phases/phase-10-plan.md), and [follow-up plan](docs/phases/phase-10-follow-up-plan.md). Implementation stops for learning review. JWT login is Phase 11; authentication state and login forms remain later work. Phase 15 no longer includes registration UI because it was delivered here. Bookings remain later phases. Git stays yours to manage.
