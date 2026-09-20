# Constrained extension manifests

Extensions are declarative and do not execute arbitrary server code. A manifest declares its key/version/core compatibility, permissions, namespaced routes, event subscriptions/emissions, field configuration schema, admin extension points, exact network origins, capability needs and typed connection requests.

`requested` never means `granted`: installation persists only explicitly approved permission, network and connection grants. External HTTP, wildcard origins, credentials in URLs, routes outside `/extensions/<key>`, and non-namespaced emitted events are rejected. An installed extension still has no raw database, plaintext secret, service-role, filesystem or arbitrary-network access.
