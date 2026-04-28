import { describe, expect, it } from "vitest";
import {
  checkPasswordStrength,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENTS_MESSAGE,
} from "@shared/passwordStrength";

describe("checkPasswordStrength", () => {
  it("rejects passwords shorter than the minimum length", () => {
    const result = checkPasswordStrength("a1b2");
    expect(result.ok).toBe(false);
    expect(result.hasMinLength).toBe(false);
    expect(result.hasLetter).toBe(true);
    expect(result.hasDigit).toBe(true);
    expect(result.message).toMatch(
      new RegExp(`at least ${PASSWORD_MIN_LENGTH} characters`),
    );
  });

  it("rejects an empty password and reports every missing requirement", () => {
    const result = checkPasswordStrength("");
    expect(result.ok).toBe(false);
    expect(result.hasMinLength).toBe(false);
    expect(result.hasLetter).toBe(false);
    expect(result.hasDigit).toBe(false);
    expect(result.message).toMatch(/at least \d+ characters/);
    expect(result.message).toMatch(/a letter/);
    expect(result.message).toMatch(/a number/);
  });

  it("rejects a long password that has no letters", () => {
    const result = checkPasswordStrength("12345678");
    expect(result.ok).toBe(false);
    expect(result.hasMinLength).toBe(true);
    expect(result.hasLetter).toBe(false);
    expect(result.hasDigit).toBe(true);
    expect(result.message).toMatch(/a letter/);
    expect(result.message).not.toMatch(/a number/);
    expect(result.message).not.toMatch(/at least \d+ characters/);
  });

  it("rejects a long password that has no digits", () => {
    const result = checkPasswordStrength("abcdefgh");
    expect(result.ok).toBe(false);
    expect(result.hasMinLength).toBe(true);
    expect(result.hasLetter).toBe(true);
    expect(result.hasDigit).toBe(false);
    expect(result.message).toMatch(/a number/);
    expect(result.message).not.toMatch(/a letter/);
    expect(result.message).not.toMatch(/at least \d+ characters/);
  });

  it("accepts a password that meets every requirement", () => {
    const result = checkPasswordStrength("secret123");
    expect(result.ok).toBe(true);
    expect(result.hasMinLength).toBe(true);
    expect(result.hasLetter).toBe(true);
    expect(result.hasDigit).toBe(true);
    expect(result.message).toBeNull();
  });

  it("treats unicode letters/digits conservatively (ASCII-only check)", () => {
    // The shared implementation uses /[A-Za-z]/ and /\d/, so a password
    // built entirely from non-ASCII letters must be rejected. Locking this
    // in keeps the canonical rule message accurate.
    const result = checkPasswordStrength("Пароль12");
    expect(result.ok).toBe(false);
    expect(result.hasLetter).toBe(false);
  });

  it("exposes a stable public requirements message", () => {
    expect(PASSWORD_REQUIREMENTS_MESSAGE).toMatch(
      new RegExp(`at least ${PASSWORD_MIN_LENGTH} characters`),
    );
    expect(PASSWORD_REQUIREMENTS_MESSAGE).toMatch(/letter/);
    expect(PASSWORD_REQUIREMENTS_MESSAGE).toMatch(/number/);
  });
});
