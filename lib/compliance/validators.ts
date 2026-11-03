// Pattern checks only. GSTIN checksum validation is out of scope (see plan open item 9).
export const GSTIN_PATTERN: RegExp = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const UPI_VPA_PATTERN: RegExp = /^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,30}$/;
const FSSAI_PATTERN = /^\d{14}$/;

export function isValidGstin(input: string): boolean {
  return GSTIN_PATTERN.test(input.trim().toUpperCase());
}

export function isValidFssai(input: string): boolean {
  return FSSAI_PATTERN.test(input.trim());
}

export function isValidVpa(input: string): boolean {
  return UPI_VPA_PATTERN.test(input.trim());
}
