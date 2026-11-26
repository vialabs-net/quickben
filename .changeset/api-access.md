---
"@quickben/api-access": patch
---

New package `@quickben/api-access` for machine API access, with no runtime dependencies:

- API keys: `createApiKey`, `parseApiKey`, `verifyApiKeySecret`, `bearerToken`. Token format `<prefix>_<keyId>_<secret>`.
- Scopes: `hasScopes`, `missingScopes`. `"*"` grants every scope.
- Quotas: `createQuotaLimiter` with fixed and calendar-month windows, `quotaHeaders`. A refused request is not counted.
- Cache: `createCache`, a read-through JSON cache with tags and hit/miss counters.
- Stores: `memoryQuotaStore`, `memoryCacheStore`, `redisQuotaStore`, `redisCacheStore` (any client with the `RedisLike` commands, such as ioredis).
