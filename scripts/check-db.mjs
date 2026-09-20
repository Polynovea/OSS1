import pg from "pg";
import { readFileSync } from "fs";

for (const raw of readFileSync(".env.local", "utf8").split("\n")) {
  const m = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const client = new pg.Client({
  connectionString: process.env.Database_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const { rows } = await client.query(`
  SELECT proname, pg_get_function_identity_arguments(p.oid) as args
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  ORDER BY proname, args;
`);
for (const r of rows) {
  console.log(r.proname, "ARGS:", r.args);
}
await client.end();
