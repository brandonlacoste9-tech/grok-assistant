/**
 * Prefix localStorage keys by Clerk user id (or "anon").
 * Call setStorageScope(userId) whenever auth state changes.
 */
let scope = "anon";

export function setStorageScope(userId: string | null | undefined) {
  scope = userId && userId.trim() ? userId.trim() : "anon";
}

export function getStorageScope() {
  return scope;
}

export function scopedKey(base: string) {
  return `${base}__${scope}`;
}
