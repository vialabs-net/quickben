# @quickben/email-resend

## 0.4.1

### Patch Changes

- 7118b54: Transactional email.
  
  - `@quickben/core`: `EmailAdapter` (`send(message)` returns `sent`, `not_configured` or `failed`, never throws for provider errors), config `email` (read back as `qb.config.email`), `memoryEmail`, `disabledEmail`, `parseEmailAddress`, `isValidEmailAddress`, `prepareEmail`, `sendEmailRequest`, `resolveEmailApiKey`, `isRetryableStatus`.
  - `@quickben/email-resend`: new adapter for the Resend REST API. `idempotencyKey` goes in the `Idempotency-Key` header; a key that a header cannot carry is a non-retryable failure.
  - `@quickben/email-sendgrid`: new adapter for the SendGrid v3 Mail Send API. SendGrid has no idempotency header: the key goes in `custom_args.idempotency_key`.
  - `sendEmailRequest` sends only to `https://` URLs. Adapters take `allowHttp: true` for a local test server.
