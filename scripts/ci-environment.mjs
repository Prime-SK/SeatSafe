import { writeFile } from "node:fs/promises";
// All database/signing values here are public disposable CI fixtures.
if (process.env.CI !== "true")
  throw Error("This fixture setup may run only in disposable CI.");
if (!process.env.PRIMENG_LICENSE?.trim())
  throw Error(
    "Configure the PRIMENG_LICENSE repository secret before running release/browser CI.",
  );
await writeFile(
  "api/.env",
  [
    "NODE_ENV=development",
    "PORT=3000",
    "DB_HOST=127.0.0.1",
    "DB_PORT=5432",
    "DB_NAME=seatsafe_dev",
    "DB_USER=seatsafe_app",
    "DB_PASSWORD=public-ci-database-password",
    "DB_SSL=false",
    "JWT_SECRET=public-ci-signing-secret-at-least-32-bytes",
    "AUTH_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:4200",
    "RELIABILITY_LAB_ENABLED=false",
    "",
  ].join("\n"),
  { flag: "wx" },
);
await writeFile(
  "web/public/primeui-license.local.json",
  JSON.stringify({ license: process.env.PRIMENG_LICENSE }),
  { flag: "wx" },
);
console.log(
  "Disposable CI settings prepared without logging licence or credentials.",
);
