import { pathnameHeaders } from "@quickben/next";
import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";

/**
 * Gives server components and server actions the page path, so
 * `tenancy({ activeOrganization: organizationFromPath("/orgs/:organization") })` can read the
 * organization from the URL.
 */
export function proxy(request: NextRequest) {
  return NextResponse.next({ request: { headers: pathnameHeaders(request) } });
}

export const config = { matcher: ["/orgs/:path*"] };
