# SeatSafe

A workshop reservation project built step by step with Angular, NestJS, and PostgreSQL.

Start with the [documentation index](docs/README.md), [implementation plan](docs/implementation-plan.md), and [Phase 8 workshop reads guide](docs/phases/phase-08-workshop-reads.md). Configuration and connection are explained in [Phase 5](docs/phases/phase-05-configuration.md) and [Phase 6](docs/phases/phase-06-postgresql.md); table creation and seeding are explained in [Phase 7](docs/phases/phase-07-workshop-data.md).

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

Open the frontend at [localhost:4200](http://localhost:4200). The backend starter now lives at [localhost:3000/api](http://localhost:3000/api).

The workshop API supports:

- [List workshops](http://localhost:3000/api/workshops).
- [View a workshop](http://localhost:3000/api/workshops/workshop-1).
- [Try a missing workshop](http://localhost:3000/api/workshops/unknown), which returns HTTP 404.

[Database health](http://localhost:3000/api/health) returns HTTP 200 with `{"status":"ok","database":"up"}` when its query succeeds. A later database failure produces standard HTTP 503 with `Database unavailable`. If the initial connection fails after three attempts, the backend exits before listening.

Open [Swagger UI](http://localhost:3000/swagger) to see all current endpoints and test them with **Try it out → Execute**. For workshop detail, enter `workshop-1` or `unknown` in the `id` field. The machine-readable API document is at [swagger-json](http://localhost:3000/swagger-json). Use your configured API port if different from 3000. Swagger is served by the backend; Angular does not need to run for it.

Stop each server with Ctrl+C. The backend validates local settings through ConfigModule; process environment settings override matching `.env` keys. PORT defaults to 3000, but database name, login, and password are required. `.env.example` contains a blank password placeholder and cannot connect as-is. Never share the private `.env`.

The runtime helper selects compatible Node 24 and project-local npm for that terminal only. See the Phase 1 guide for setup on another computer and dependency installation.

From `api/`, after runtime activation, use `npm run db:migration:show` to inspect status and `npm run db:migration:run` to apply pending migrations. Each builds first and uses the compiled DataSource. The workshop migration is already applied on this computer. Automatic schema synchronization and automatic startup migration execution are disabled. `npm run db:migration:revert` now drops the workshop table and its rows; reversal is demonstrated only inside the isolated database tests.

Run `npm run db:seed` after migrations to insert the three development workshops. It builds first, requires development mode, and preserves existing IDs without resetting their data. It has already inserted all three records here; a repeat reports `0 inserted, 3 skipped`. No provisioning or seed runs automatically at API startup.

Backend verification: `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`, and `npm run test:db`. Build and lint passed; 33 unit tests, 13 mocked HTTP tests, and 27 real PostgreSQL tests passed. Unit/HTTP tests do not need local credentials. The explicit database suites require `seatsafe_dev` and use disposable random schemas; they do not truncate or revert development tables. All 18 Phase 7 database checks remain, alongside nine database-backed HTTP cases.

Phase 8 reads workshops from PostgreSQL through an injected TypeORM repository. Lists are ordered by start time, then ID, including closed, sold-out, and past workshops. Both routes return exactly six fields with calculated availability; stored timestamps remain private. Empty tables return `[]`, missing IDs return 404, and failed queries return standard 503 with `Database unavailable`. With unchanged seed data, reservations are zero and availability is 20, 10, and 12. The learner confirmed these three rows in pgAdmin after Phase 7. Fictional reservation counts now exist only in test fixtures. Live Swagger checks passed and development records were unchanged.

Angular remains its generated starter until Phase 9. Request-body validation, accounts, and reservations remain later work.

Read [the Phase 8 guide](docs/phases/phase-08-workshop-reads.md), [checkpoint with 20 questions and answers](docs/phases/phase-08-checkpoint.md), and [saved implementation plan](docs/phases/phase-08-plan.md). Implementation stops for your review; Git remains yours to manage. The historical TypeScript lesson remains on your separate branch. The original Phase 4 service/module milestone is already covered by Phase 3.
