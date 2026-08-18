import type { NextFunction, Request, Response } from 'express';
import { ACCESS_DENIED, mayEnterInstance, parseAllowedRoles } from 'shared';

// Read once at import time, like SECURE_COOKIES and SESSION_TTL_DAYS: there is
// no .env loader, the values come from the systemd EnvironmentFile and a change
// only takes effect after `systemctl restart`.
const ALLOWED_ROLES = parseAllowedRoles(process.env.RESTRICT_TO_ROLES);

/** False on production, true on an instance that names roles (dev). */
export const instanceRestricted = ALLOWED_ROLES.size > 0;

export function mayEnter(user?: { isGm: boolean; isAdmin: boolean }): boolean {
  return mayEnterInstance(ALLOWED_ROLES, user);
}

// /login answers with ACCESS_DENIED itself, so the message reaches the form
// instead of a bare 403; /logout has to work for anyone holding a cookie.
const ALWAYS_OPEN = new Set(['/login', '/logout']);

/**
 * Second line of defence behind the check in POST /login: a session created
 * before a role was taken away must not keep working. Mount this as the FIRST
 * middleware on the api router — anything mounted above it (a sub-router, say)
 * would bypass the gate entirely.
 */
export function instanceGate(req: Request, res: Response, next: NextFunction): void {
  if (!instanceRestricted) {
    next();
    return;
  }

  // Express 5 routes case-insensitively and tolerates a trailing slash, so the
  // exemptions have to be matched the same way.
  const path = req.path.replace(/\/+$/, '').toLowerCase() || '/';
  if (ALWAYS_OPEN.has(path)) {
    next();
    return;
  }

  // Not logged in at all: fall through, so requireAuth answers 401 as it always
  // has. The client only treats 401 as "session gone" (client/src/api.ts); a 403
  // here would leave an expired tab stuck in the logged-in shell.
  if (!req.user) {
    next();
    return;
  }

  if (mayEnter(req.user)) {
    next();
    return;
  }
  res.status(403).json({ error: ACCESS_DENIED });
}
