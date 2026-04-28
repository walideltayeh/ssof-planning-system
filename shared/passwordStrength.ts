export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_REQUIREMENTS_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include a letter and a number.`;

export interface PasswordStrengthResult {
  ok: boolean;
  hasMinLength: boolean;
  hasLetter: boolean;
  hasDigit: boolean;
  message: string | null;
}

export function checkPasswordStrength(password: string): PasswordStrengthResult {
  const hasMinLength = password.length >= PASSWORD_MIN_LENGTH;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const ok = hasMinLength && hasLetter && hasDigit;

  let message: string | null = null;
  if (!ok) {
    const missing: string[] = [];
    if (!hasMinLength) missing.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
    if (!hasLetter) missing.push("a letter");
    if (!hasDigit) missing.push("a number");
    message = `Password must contain ${missing.join(", ")}.`;
  }

  return { ok, hasMinLength, hasLetter, hasDigit, message };
}
