import pg from "pg";
import { readFileSync } from "fs";

for (const raw of readFileSync(".env.local", "utf8").split("\n")) {
  const match = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const client = new pg.Client({
  connectionString: process.env.Database_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const routes = await client.query("select id, path, title from content_routes");
const redirs = await client.query("select id, source_path, target_path from content_redirects");
const taxes = await client.query("select id, name, slug from taxonomies");
const menus = await client.query("select id, key, name from navigation_menus");
const cols = await client.query("select id, name, slug from media_collections");

console.log("Current Live State:");
console.log("- Routes:", routes.rows);
console.log("- Redirects:", redirs.rows);
console.log("- Taxonomies:", taxes.rows);
console.log("- Menus:", menus.rows);
console.log("- Media Collections:", cols.rows);

await client.end();
