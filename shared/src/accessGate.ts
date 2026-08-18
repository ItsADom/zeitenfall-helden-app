// Instance-level access gate.
//
// A deployment can restrict itself to a set of roles via RESTRICT_TO_ROLES —
// "gm,admin" on the dev instance, so that only Spielleitung and Verwaltung get
// in. An unset or empty value means "open to everyone", which is what
// production runs; nothing changes there.
//
// This lives in `shared` rather than `server` because `shared` is the only
// workspace with a test runner (see shared/package.json). The Express wiring
// sits in server/src/accessGate.ts.

/** Shown to someone whose role is not allowed on this instance. */
export const ACCESS_DENIED = 'Diese Ausgabe ist der Spielleitung und der Verwaltung vorbehalten.';

/**
 * Parses RESTRICT_TO_ROLES. An empty set means the instance is open — that is
 * the default, so a missing variable can never lock anyone out by accident.
 */
export function parseAllowedRoles(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Roles combine rather than nest (see UserInfo in types.ts): a user passes as
 * soon as one of their flags is listed. Everyone is additionally a player, so a
 * plain player without flags only ever gets in through an open instance.
 */
export function mayEnterInstance(allowed: Set<string>, user?: { isGm: boolean; isAdmin: boolean }): boolean {
  if (allowed.size === 0) return true;
  if (!user) return false;
  return (allowed.has('gm') && user.isGm) || (allowed.has('admin') && user.isAdmin);
}
