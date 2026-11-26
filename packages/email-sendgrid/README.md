# @quickben/email-sendgrid

Transactional email for [Quickben](https://quickben.vialabs.net) apps through the [SendGrid](https://sendgrid.com) v3 Mail Send API (`POST /v3/mail/send`). Uses `fetch`; no SDK.

```sh
pnpm add @quickben/email-sendgrid
```

```ts
import { defineConfig } from "@quickben/core";
import { sendgridEmail } from "@quickben/email-sendgrid";

export default defineConfig({
  db,
  email: sendgridEmail({ apiKey: process.env.SENDGRID_API_KEY, from: "Acme <no-reply@acme.com>" }),
  collections: [],
});
```

| Option      | Default                    | Purpose                                                          |
| ----------- | -------------------------- | ---------------------------------------------------------------- |
| `apiKey`    | required                   | `SG.…` key with Mail Send access, or a function that returns it. |
| `from`      | none                       | Default sender. The message `from` wins.                         |
| `baseUrl`   | `https://api.sendgrid.com` | API root. `SENDGRID_EU_URL` for EU accounts.                     |
| `fetch`     | global `fetch`             | Your own `fetch`.                                                |
| `timeoutMs` | `10000`                    | Time to wait for SendGrid.                                       |

`202` maps to `{ status: "sent", id }`, with `id` from `X-Message-Id`. Errors map to `{ status: "failed", detail, retryable, statusCode }`, with SendGrid's `errors[].message` in `detail`. `send` does not throw.

SendGrid has no idempotency header, so a retry after a lost answer can send twice. `idempotencyKey` goes in `custom_args.idempotency_key`, which shows in the Activity feed and Event Webhook payloads. `tags` also go in `custom_args`.

Docs: https://quickben.vialabs.net/docs/email/sendgrid
