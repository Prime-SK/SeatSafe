# SeatSafe working agreement

- Implement only one phase from `docs/implementation-plan.md` per user request, unless the user explicitly asks for a different scope.
- At the end of a phase, explain the result and stop for the user's learning checkpoint. Do not automatically start the next phase.
- Create or update `docs/phases/phase-NN-<topic>.md` for every implemented phase. Explain the goal, prerequisite knowledge, changed files, design decisions, feature logic, useful project commands with their purpose and expected result, verification, an exercise, and two interview questions.
- Document commands that help the learner set up, generate, install, run, test, or implement the project. Omit internal agent inspections, sandbox permissions, raw execution transcripts, documentation tooling, and incidental troubleshooting unless the learner needs it to reproduce or understand the project. Never record secrets.
- The user manages Git. Do not run Git commands or change Git configuration, branches, staging, commits, or remotes unless the user explicitly requests that specific work.
- Update `docs/progress.md` after each phase. Distinguish implementation completion from the user's learning review.
- Keep documentation beginner-friendly and explain new terms before using them.
- Use TypeScript, Angular, NestJS with Express, PostgreSQL, and TypeORM. Database migrations are explicit; automatic schema synchronization stays disabled when the database is introduced.
- Preserve the agreed reliability and authentication rules in the implementation plan.
- Run checks appropriate to the phase. Never describe checks as passed without observed evidence.
