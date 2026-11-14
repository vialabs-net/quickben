import { createAdminI18n, englishI18n, missingMessages } from "@quickben/admin/i18n";
import {
  ConfigError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@quickben/core";
import { describe, expect, it } from "vitest";

import { OrganizationError, TenancyRuleError } from "../src";
import { tenancyMessages } from "../src/admin";
import {
  errorCode,
  errorCodes,
  errorMessage,
  toastCodes,
  toastMessage,
} from "../src/admin/feedback";
import { roleLabel, statusLabel } from "../src/admin/messages";

const t = englishI18n.scope(tenancyMessages).t;

describe("tenancy admin feedback codes", () => {
  it("maps errors to codes", () => {
    expect(errorCode(new OrganizationError("suspended", 'Organization "x" is suspended'))).toBe(
      "organization-suspended",
    );
    expect(errorCode(new TenancyRuleError("higher-role", 'Only a higher role "x"'))).toBe(
      "higher-role",
    );
    expect(errorCode(new ConflictError("taken", "slug"))).toBe("slug-taken");
    expect(errorCode(new ConflictError("taken", "memberKey"))).toBe("already-member");
    expect(errorCode(new ConflictError("taken"))).toBe("conflict");
    expect(errorCode(new ValidationError([{ path: "slug", message: "bad" }]))).toBe("invalid-slug");
    expect(errorCode(new ValidationError([{ path: "name", message: "bad" }]))).toBe("invalid");
    expect(errorCode(new UnauthorizedError("no"))).toBe("unauthorized");
    expect(errorCode(new ForbiddenError("no"))).toBe("forbidden");
    expect(errorCode(new NotFoundError("no"))).toBe("not-found");
    expect(errorCode(new ConfigError("no"))).toBe("failed");
  });

  it("every code has a message", () => {
    for (const reason of ["none", "ambiguous", "not-member", "unknown", "suspended"] as const) {
      expect(errorMessage(t, errorCode(new OrganizationError(reason, "")))).toBeTruthy();
    }
    for (const code of errorCodes) expect(errorMessage(t, code)).not.toMatch(/^error\./);
    for (const code of toastCodes) expect(toastMessage(t, code)).not.toMatch(/^toast\./);
  });

  it("ignores unknown codes", () => {
    expect(errorMessage(t, "Free text")).toBeUndefined();
    expect(errorMessage(t, "constructor")).toBeUndefined();
    expect(errorMessage(t, undefined)).toBeUndefined();
    expect(toastMessage(t, "hasOwnProperty")).toBeUndefined();
  });

  it("translates codes, roles and statuses", () => {
    const es = createAdminI18n({ locale: "es", timeZone: "UTC", overrides: {} }).scope(
      tenancyMessages,
    ).t;
    expect(errorMessage(es, "forbidden")).toBe("No tienes permiso para hacer eso.");
    expect(toastMessage(es, "invited")).toBe("Invitación creada");
    expect(roleLabel(es, "owner")).toBe("Propietario");
    expect(roleLabel(es, "auditor")).toBe("auditor");
    expect(roleLabel(es, "toString")).toBe("toString");
    expect(statusLabel(es, "suspended")).toBe("Suspendido");
    expect(statusLabel(t, "archived")).toBe("archived");
  });
});

describe("tenancy messages", () => {
  it("has every key in Spanish", () => {
    expect(missingMessages(tenancyMessages)).toEqual([]);
  });
});
