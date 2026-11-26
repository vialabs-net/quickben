# @quickben/api-access

API keys, scopes, quota windows and a read-through cache for machine API access. No runtime dependencies. The Redis stores take any client with the `RedisLike` commands, such as ioredis.

```ts
import {
  bearerToken,
  createApiKey,
  createQuotaLimiter,
  memoryQuotaStore,
  parseApiKey,
  quotaHeaders,
  verifyApiKeySecret,
} from "@quickben/api-access";

const issued = createApiKey({ prefix: "acme_sk" });
// Store issued.keyId, issued.secretHash and issued.hint. Show issued.token once.

const parsed = parseApiKey(bearerToken(req.headers.authorization) ?? "", { prefix: "acme_sk" });
if (!parsed || !verifyApiKeySecret(parsed.secret, storedHash)) return reply.code(401).send();

const limiter = createQuotaLimiter({
  store: memoryQuotaStore(),
  windows: [
    { name: "minute", kind: "fixed", ms: 60_000 },
    { name: "month", kind: "calendar-month", timeZone: "America/Santiago" },
  ],
});
const quota = await limiter.consume(parsed.keyId, { limits: { minute: 60, month: 10_000 } });
reply.headers(quotaHeaders(quota));
```

| Export                                 | Purpose                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `createApiKey`, `parseApiKey`          | Token `<prefix>_<keyId>_<secret>`. `keyId`: 12 base36. `secret`: 32 base62. |
| `verifyApiKeySecret`                   | Compares a secret with its SHA-256 hex hash in constant time.               |
| `bearerToken`                          | Token from `Authorization: Bearer …`, else from a raw API key header.       |
| `hasScopes`, `missingScopes`           | Exact match. `"*"` grants every scope.                                      |
| `createQuotaLimiter`                   | Fixed and calendar-month windows. A refused request is not counted.         |
| `quotaHeaders`                         | `X-RateLimit-Limit-<Window>`, `-Remaining-`, `-Reset-`, `Retry-After`.      |
| `createCache`                          | Read-through JSON cache with tags and hit/miss counters.                    |
| `memoryQuotaStore`, `memoryCacheStore` | In-process stores for tests and one server.                                 |
| `redisQuotaStore`, `redisCacheStore`   | Redis stores. Default prefixes `qb:quota:` and `qb:cache:`.                 |

Docs: [quickben.vialabs.net/docs/api-access](https://quickben.vialabs.net/docs/api-access).
