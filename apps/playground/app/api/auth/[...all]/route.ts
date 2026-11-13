import { toNextJsHandler } from "better-auth/next-js";

import { betterAuthEnabled, getAuth } from "@/lib/better-auth";

/** Better Auth routes. They answer 404 unless QUICKBEN_AUTH=better-auth. */
function route(method: "GET" | "POST") {
  return async (req: Request) => {
    if (!betterAuthEnabled) return Response.json({ error: "Not found" }, { status: 404 });
    return toNextJsHandler(await getAuth())[method](req);
  };
}

export const GET = route("GET");
export const POST = route("POST");
