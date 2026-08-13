import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.js';

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  isGm: boolean;
  isAdmin: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64);
  const stored64 = Buffer.from(hash, 'hex');
  // Ungleiche Länge (z. B. beschädigter Datensatz) ließe timingSafeEqual werfen —
  // vorher abfangen und als „passt nicht" behandeln.
  if (stored64.length !== check.length) return false;
  return crypto.timingSafeEqual(check, stored64);
}

// Sitzungen laufen nach einer festen Frist ab (Standard 30 Tage), damit ein
// abgegriffenes oder vergessenes Token nicht unbegrenzt gültig bleibt.
export const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS) || 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, Date.now());
  return token;
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Abgelaufene Sitzungen entfernen (beim Start und periodisch aufgerufen)
export function cleanupSessions(): void {
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - SESSION_TTL_MS);
}

export function getSessionToken(req: Request): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === 'helden_session') return v ?? null;
  }
  return null;
}

export function userForToken(token: string): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name AS displayName, u.is_gm AS isGm, u.is_admin AS isAdmin, s.created_at AS createdAt
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    )
    .get(token) as
    | { id: number; username: string; displayName: string; isGm: number; isAdmin: number; createdAt: number }
    | undefined;
  if (!row) return null;
  if (Date.now() - row.createdAt > SESSION_TTL_MS) {
    destroySession(token);
    return null;
  }
  return { id: row.id, username: row.username, displayName: row.displayName, isGm: !!row.isGm, isAdmin: !!row.isAdmin };
}

export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = getSessionToken(req);
  if (token) req.user = userForToken(token) ?? undefined;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Nicht angemeldet' });
    return;
  }
  next();
}

export function requireGm(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isGm) {
    res.status(403).json({ error: 'Nur für den Spielleiter' });
    return;
  }
  next();
}

// Kontoverwaltung: Konten anlegen, Rollen vergeben, Konten löschen. Bewusst
// GETRENNT von requireGm — ein Admin verwaltet Zugänge, sieht aber keine
// Charakterbögen (siehe UserInfo).
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: 'Nur für die Verwaltung' });
    return;
  }
  next();
}

// Die Benutzerliste und das Anlegen einfacher Spieler dürfen BEIDE — die
// Spielleitung (zum Onboarding ihrer Spieler) und die Verwaltung. Rollenvergabe
// und Löschen bleiben der Verwaltung vorbehalten (in den Handlern geprüft).
export function requireGmOrAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isGm && !req.user?.isAdmin) {
    res.status(403).json({ error: 'Nur für Spielleitung oder Verwaltung' });
    return;
  }
  next();
}
