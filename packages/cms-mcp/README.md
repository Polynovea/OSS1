# Polynovea CMS MCP

`@polynovea/cms-mcp` is a stdio JSON-RPC MCP transport. Configure `POLYNOVEA_CMS_URL` and a scoped, agent-bound `POLYNOVEA_CMS_TOKEN`. The transport never receives a database connection, service-role key, filesystem access, or unbounded network authority.

It first records authorization/provenance through `/api/v1/agent-tools`, then calls the normal `/api/v1` endpoint for the CMS operation. High-risk tools therefore retain ordinary scopes, approvals, deterministic plans, simulations and evidence.
