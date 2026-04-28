import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  clearDeniedCountry,
  getDeniedCountry,
  setDeniedCountry,
  useDeniedCountry,
} from "./countryAccessStore";

describe("countryAccessStore", () => {
  beforeEach(() => {
    clearDeniedCountry();
  });

  afterEach(() => {
    clearDeniedCountry();
  });

  it("starts out with no denied country", () => {
    expect(getDeniedCountry()).toBeNull();
  });

  it("records and exposes the denied country", () => {
    setDeniedCountry("Lebanon");
    expect(getDeniedCountry()).toBe("Lebanon");
  });

  it("clearDeniedCountry resets the value to null", () => {
    setDeniedCountry("Libya");
    expect(getDeniedCountry()).toBe("Libya");

    clearDeniedCountry();
    expect(getDeniedCountry()).toBeNull();
  });

  it("useDeniedCountry exposes the current value and updates on change", () => {
    const { result } = renderHook(() => useDeniedCountry());

    expect(result.current).toBeNull();

    act(() => {
      setDeniedCountry("Syria");
    });
    expect(result.current).toBe("Syria");

    act(() => {
      setDeniedCountry("Lebanon");
    });
    expect(result.current).toBe("Lebanon");

    act(() => {
      clearDeniedCountry();
    });
    expect(result.current).toBeNull();
  });
});
