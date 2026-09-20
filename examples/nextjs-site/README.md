# Next.js delivery example

This minimal site demonstrates server-side consumption of published Polynovea content.

Create a developer token with the published-content read scope and configure:

```text
POLYNOVEA_CMS_URL=http://localhost:3210
POLYNOVEA_CMS_TOKEN=pnv_...
```

Run `npm install` and `npm run dev` in this directory. Keep the token server-only; never use a `NEXT_PUBLIC_*` variable for it.
