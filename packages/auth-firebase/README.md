# @quickben/auth-firebase

Firebase Authentication for [Quickben](https://quickben.vialabs.net): session cookies, a session route, a browser client with Google One Tap, and a sign-in page.

```sh
pnpm add @quickben/auth-firebase firebase-admin firebase
```

```ts
// lib/auth.ts
import { firebaseAuth } from "@quickben/auth-firebase";
export const firebase = firebaseAuth({ roles: "roles" });

// quickben.config.ts
export default defineConfig({ db, collections, auth: firebase });

// app/api/auth/session/route.ts
export const { GET, POST, DELETE } = firebase.handlers;
```

The browser signs in with the Firebase client SDK and posts the ID token to the route. The route verifies it (with a revocation check and a recent sign-in check) and sets an `HttpOnly` session cookie. `getUser` verifies that cookie on each request.

## Entries

| Entry                            | Contents                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `@quickben/auth-firebase`        | `firebaseAuth(options)`: `getUser`, `verify`, `handlers`, `revokeSessions`      |
| `@quickben/auth-firebase/client` | `createSessionClient`, `useGoogleOneTap`, `SessionKeeper`, `useSessionKeeper`   |
| `@quickben/auth-firebase/admin`  | `FirebaseSignInPage`: Google, One Tap and password sign-in in the admin's style |

## Options of `firebaseAuth`

| Option                 | Default     | Purpose                                                          |
| ---------------------- | ----------- | ---------------------------------------------------------------- |
| `auth`                 | default app | `firebase-admin` Auth, or a function that returns it.            |
| `cookieName`           | `__session` | Session cookie name.                                             |
| `cookie`               | `{}`        | `path`, `domain`, `sameSite`, `secure`.                          |
| `sessionMaxAge`        | 5 days      | Seconds, 5 minutes to 14 days.                                   |
| `checkRevoked`         | `true`      | Revocation check on every request.                               |
| `maxAuthAge`           | `300`       | Seconds since sign-in allowed when creating a session. `0`: off. |
| `requireVerifiedEmail` | `false`     | Refuse sessions for unverified emails.                           |
| `roles`                | `"roles"`   | Custom claim name, or a function of the claims.                  |
| `resolveUser`          | none        | Map or refuse (`null`) the user.                                 |
| `bearer`               | `false`     | Accept `Authorization: Bearer <ID token>`.                       |
| `revokeOnSignOut`      | `false`     | Sign-out revokes refresh tokens on every device.                 |
| `csrf`                 | same origin | `trustedOrigins` of the session route.                           |

`firebase` and `firebase-admin` are optional peers: the server entry needs `firebase-admin`, the client and admin entries need `firebase`.

Docs: https://quickben.vialabs.net/docs/auth/firebase
