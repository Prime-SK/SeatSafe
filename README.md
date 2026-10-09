# SeatSafe

A workshop reservation project built step by step with Angular, NestJS, and eventually PostgreSQL.

Start with the [documentation index](docs/README.md), [implementation plan](docs/implementation-plan.md), and [Phase 1 learning guide](docs/phases/phase-01-environment.md).

## Run the Phase 1 starters

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

Open the frontend at [localhost:4200](http://localhost:4200) and the backend starter at [localhost:3000](http://localhost:3000). Stop each server with Ctrl+C.

The runtime helper selects compatible Node 24 and project-local npm for that terminal only. See the Phase 1 guide for setup on another computer and dependency installation.

Accounts, workshops, database access, and reservations will be added in their planned phases. The Phase 1 apps are separate framework starters.
