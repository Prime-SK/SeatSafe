import { writeFile } from "node:fs/promises";

// Run from the root npm command. Never replace the local development settings.
try {
  const direct = process.env.DATABASE_URL_UNPOOLED;
  if (!direct) throw Error();
  const url = new URL(direct);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname.endsWith(".neon.tech") ||
    url.hostname.includes("-pooler.") ||
    !url.username ||
    !url.password ||
    url.pathname.length < 2
  )
    throw Error();
  const values = {
    NODE_ENV: "production",
    DB_HOST: url.hostname,
    DB_PORT: url.port || "5432",
    DB_NAME: decodeURIComponent(url.pathname.slice(1)),
    DB_USER: decodeURIComponent(url.username),
    DB_PASSWORD: decodeURIComponent(url.password),
    DB_SSL: "true",
  };
  await writeFile(
    new URL("../api/.env.production.local", import.meta.url),
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "Separate production database settings created with verified TLS; development settings unchanged.",
  );
} catch {
  console.error(
    "Database settings were not written. Require a direct Neon URL and a new api/.env.production.local; inspect existing files privately before proceeding.",
  );
  process.exitCode = 1;
}
