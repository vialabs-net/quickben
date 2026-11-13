export { loadGoogleIdentity, useGoogleOneTap } from "./one-tap";
export {
  createSessionClient,
  defaultIdentityKey,
  defaultSessionEndpoint,
  getFirebaseAuth,
  googleProvider,
  publishIdentity,
  SessionRequestError,
} from "./session-client";
export { SessionKeeper, useSessionKeeper } from "./session-keeper";

export type { GoogleAccountsId, GoogleOneTapOptions } from "./one-tap";
export type { FirebaseSessionClient, SessionClientOptions, SignInOptions } from "./session-client";
export type { SessionKeeperOptions } from "./session-keeper";
