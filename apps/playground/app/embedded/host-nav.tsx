import { getAdminNav } from "@quickben/admin";

import config from "@/quickben.config";

import { HostNavLinks } from "./host-nav-links";
import { embeddedOptions } from "./options";

/** The host app's own navigation, built from the admin nav model. Render it in `<Suspense>`. */
export async function HostNav() {
  const nav = await getAdminNav(config, embeddedOptions);
  return <HostNavLinks nav={nav} />;
}
