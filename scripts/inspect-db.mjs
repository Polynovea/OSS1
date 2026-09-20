import pg from 'pg';
import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const client = new pg.Client({ connectionString: process.env.Database_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const res = await client.query("select table_name from information_schema.tables where table_schema = 'public' order by table_name");
console.log(res.rows.map(r => r.table_name));
await client.end();
