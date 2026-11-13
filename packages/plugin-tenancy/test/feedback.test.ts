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
import {
  errorCode,
  errorMessage,
  errorMessages,
  toastMessage,
  toastMessages,
} from "../src/admin/feedback";

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
      expect(errorMessage(errorCode(new OrganizationError(reason, "")))).toBeTruthy();
    }
    for (const code of Object.keys(errorMessages)) expect(errorMessage(code)).toBeTruthy();
    for (const code of Object.keys(toastMessages)) expect(toastMessage(code)).toBeTruthy();
  });

  it("ignores unknown codes", () => {
    expect(errorMessage("Free text")).toBeUndefined();
    expect(errorMessage("constructor")).toBeUndefined();
    expect(errorMessage(undefined)).toBeUndefined();
    expect(toastMessage("hasOwnProperty")).toBeUndefined();
  });
});
