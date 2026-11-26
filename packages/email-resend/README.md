# @quickben/email-resend

Transactional email for [Quickben](https://quickben.vialabs.net) apps through the [Resend](https://resend.com) REST API. Uses `fetch`; no SDK.

```sh
pnpm add @quickben/email-resend
```

```ts
import { defineConfig } from "@quickben/core";
import { resendEmail } from "@quickben/email-resend";

export default defineConfig({
  db,
  email: resendEmail({ apiKey: process.env.RESEND_API_KEY, from: "Acme <no-reply@acme.com>" }),
  collections: [],
});

await qb.config.email?.send({
  to: "ada@example.com",
  subject: "Hi",
  text: "Hello",
  idempotencyKey: "hi-1",
});
```

| Option      | Default                  | Purpose                                    |
| ----------- | ------------------------ | ------------------------------------------ |
| `apiKey`    | required                 | `re_…` key, or a function that returns it. |
| `from`      | none                     | Default sender. The message `from` wins.   |
| `baseUrl`   | `https://api.resend.com` | API root.                                  |
| `fetch`     | global `fetch`           | Your own `fetch`.                          |
| `timeoutMs` | `10000`                  | Time to wait for Resend.                   |

`send` returns `{ status: "sent", id }`, `{ status: "not_configured", detail }` (no key or no sender) or `{ status: "failed", detail, retryable, statusCode? }`. It does not throw. `idempotencyKey` goes in the `Idempotency-Key` header. `tags` become Resend `tags`.

Docs: https://quickben.vialabs.net/docs/email/resend
