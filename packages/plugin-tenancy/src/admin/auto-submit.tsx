"use client";

import { Select } from "@quickben/admin/ui";

import type { ComponentProps } from "react";

/** A select that submits its form as soon as the choice changes. */
export function AutoSubmitSelect(props: Readonly<ComponentProps<"select">>) {
  return (
    <Select
      {...props}
      onChange={(event) => {
        event.currentTarget.form?.requestSubmit();
      }}
    />
  );
}
