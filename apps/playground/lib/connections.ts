/**
 * Connections demo switch. Start the playground with `QUICKBEN_CONNECTIONS=1` to add
 * `@quickben/plugin-connections`: an Integrations group in the admin with Connections and
 * Credentials.
 */
export const connectionsEnabled = process.env.QUICKBEN_CONNECTIONS === "1";

/**
 * Master key of the demo. `QUICKBEN_MASTER_KEY` wins; without it the playground uses a fixed,
 * public key so it runs with no setup. Never use a fixed key in a real app.
 */
export const demoMasterKey =
  process.env.QUICKBEN_MASTER_KEY ?? "cXVpY2tiZW4tcGxheWdyb3VuZC1kZW1vLWtleS0zMmI=";
