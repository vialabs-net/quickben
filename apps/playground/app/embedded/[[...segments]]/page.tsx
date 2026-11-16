import { createAdminPage, handleAdminRequest } from "@quickben/admin";
import { Suspense } from "react";

import config from "@/quickben.config";

import { HostTitle } from "../host-title";
import { embeddedOptions } from "../options";

import type { AdminPageProps, AdminRequest } from "@quickben/admin";

async function serverFunction(request: AdminRequest) {
  "use server";
  return handleAdminRequest(config, request);
}

// Only the page content: the host layout in ../layout.tsx brings the header and navigation,
// and HostTitle the page title, so the admin hides its own (`pageTitle: "none"`).
const AdminPage = createAdminPage(config, {
  ...embeddedOptions,
  chrome: "none",
  pageTitle: "none",
  serverFunction,
});

export default function EmbeddedPage(props: Readonly<AdminPageProps>) {
  return (
    <>
      <Suspense fallback={<div className="host-title" />}>
        <HostTitle params={props.params} />
      </Suspense>
      <AdminPage {...props} />
    </>
  );
}
