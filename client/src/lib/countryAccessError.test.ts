import { describe, it, expect } from "vitest";
import { TRPCClientError } from "@trpc/client";
import {
  extractCountryFromAccessError,
  isCountryAccessError,
} from "./countryAccessError";

function makeForbiddenError(message: string): TRPCClientError<never> {
  // The runtime check inspects `instanceof TRPCClientError` and `data.code`,
  // so we construct a real error and attach the data shape it looks for.
  const err = new TRPCClientError(message) as TRPCClientError<never> & {
    data?: { code?: string };
  };
  err.data = { code: "FORBIDDEN" };
  return err;
}

describe("isCountryAccessError", () => {
  it("recognises a FORBIDDEN access denial for a country", () => {
    const err = makeForbiddenError("You do not have access to Syria");
    expect(isCountryAccessError(err)).toBe(true);
  });

  it("rejects errors that are not TRPCClientError instances", () => {
    expect(isCountryAccessError(new Error("You do not have access to Syria"))).toBe(false);
    expect(isCountryAccessError("nope")).toBe(false);
    expect(isCountryAccessError(null)).toBe(false);
    expect(isCountryAccessError(undefined)).toBe(false);
  });

  it("rejects FORBIDDEN errors with a message that does not match the country pattern", () => {
    const err = makeForbiddenError("Forbidden");
    expect(isCountryAccessError(err)).toBe(false);
  });

  it("rejects TRPC errors with a different code", () => {
    const err = new TRPCClientError(
      "You do not have access to Syria",
    ) as TRPCClientError<never> & { data?: { code?: string } };
    err.data = { code: "UNAUTHORIZED" };
    expect(isCountryAccessError(err)).toBe(false);
  });
});

describe("extractCountryFromAccessError", () => {
  it("returns the country name from a matching message", () => {
    const err = makeForbiddenError("You do not have access to Lebanon");
    expect(extractCountryFromAccessError(err)).toBe("Lebanon");
  });

  it("works for multi-word country names", () => {
    const err = makeForbiddenError("You do not have access to United Arab Emirates");
    expect(extractCountryFromAccessError(err)).toBe("United Arab Emirates");
  });

  it("returns null for non-TRPC errors", () => {
    expect(
      extractCountryFromAccessError(new Error("You do not have access to Syria")),
    ).toBeNull();
    expect(extractCountryFromAccessError("nope")).toBeNull();
    expect(extractCountryFromAccessError(null)).toBeNull();
  });

  it("returns null when the message does not match the access pattern", () => {
    const err = makeForbiddenError("Forbidden");
    expect(extractCountryFromAccessError(err)).toBeNull();
  });
});
