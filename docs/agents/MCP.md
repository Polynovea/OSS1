# Governed MCP access

Run the stdio transport with `POLYNOVEA_CMS_URL` and a scoped `POLYNOVEA_CMS_TOKEN`:

```text
polynovea-cms-mcp
```

The token must be bound to an active workspace agent identity and include `agent.read` plus the tool-specific API scope. The transport records authorization/provenance through `/api/v1/agent-tools` and then calls the ordinary `/api/v1` route. It has no database, service-role, filesystem or privileged mutation channel.

Draft-only agents can read and create/update drafts but cannot publish, delete, change schemas, or execute operational plans. High-risk tools additionally need an agent in `scoped` mode, explicit scope, an initiating audited user, and any normal CMS/Phase 12.75 approval, simulation, freshness and proof requirements.
