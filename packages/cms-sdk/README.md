# @polynovea/cms-sdk

Typed client for the stable Polynovea CMS `/api/v1` Developer API.

```ts
import { PolynoveaCmsClient } from "@polynovea/cms-sdk";

const cms = new PolynoveaCmsClient({
  baseUrl: "https://cms.example.com",
  token: process.env.POLYNOVEA_CMS_TOKEN!,
});

const entries = await cms.entries.list({ model: "article" });
```

The SDK uses only the public Developer API and does not import Polynovea server internals.
