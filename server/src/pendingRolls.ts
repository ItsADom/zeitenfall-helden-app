// Offene „Spielleitung + Spieler"-Anfragen.
//
// Bewusst NUR im Arbeitsspeicher, nicht in der Datenbank: „Ablehnen
// hinterlässt keine Spur" ist trivial wahr, wenn nie etwas geschrieben wurde.
// Erst das Annehmen würfelt und legt einen Feed-Eintrag an. Dass ein
// Server-Neustart offene Anfragen verwirft, ist für diese selbst gehostete
// Einzelprozess-App verschmerzbar — die Spielleitung fragt dann neu.
import crypto from 'node:crypto';
import type { PendingRollRequest, ProbeSource } from 'shared';

/** Nach dieser Zeit verfällt eine unbeantwortete Anfrage von selbst. */
export const PENDING_TTL_MS = 5 * 60 * 1000;

const pending = new Map<string, PendingRollRequest>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function createPendingRequest(input: {
  groupId: number;
  source: ProbeSource;
  label: string;
  gmUserId: number;
  gmName: string;
  targetUserId: number;
  targetCharId: number;
  targetCharName: string;
  /** Gesetzt, wenn dies EIN Zweig einer Gruppen-Sammelanfrage ist — siehe groupRolls.ts. */
  groupRequestId?: string;
  /** Siehe PendingRollRequest.modifier — bereits geklemmt, hier nur durchgereicht. */
  modifier?: number;
  onExpire: (request: PendingRollRequest) => void;
}): PendingRollRequest {
  const now = Date.now();
  const request: PendingRollRequest = {
    id: crypto.randomUUID(),
    groupId: input.groupId,
    source: input.source,
    label: input.label,
    gmUserId: input.gmUserId,
    gmName: input.gmName,
    targetUserId: input.targetUserId,
    targetCharId: input.targetCharId,
    targetCharName: input.targetCharName,
    ...(input.groupRequestId ? { groupRequestId: input.groupRequestId } : {}),
    ...(input.modifier != null ? { modifier: input.modifier } : {}),
    createdAt: now,
    expiresAt: now + PENDING_TTL_MS,
  };
  pending.set(request.id, request);
  const timer = setTimeout(() => {
    if (pending.delete(request.id)) {
      timers.delete(request.id);
      input.onExpire(request);
    }
  }, PENDING_TTL_MS);
  timer.unref?.();
  timers.set(request.id, timer);
  return request;
}

export function getPendingRequest(id: string): PendingRollRequest | undefined {
  return pending.get(id);
}

/** Entfernt die Anfrage samt Ablauf-Timer; false, wenn es sie nicht (mehr) gab. */
export function removePendingRequest(id: string): boolean {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  return pending.delete(id);
}

/** Offene Anfragen an diesen Spieler — beim Verbinden nachgereicht. */
export function pendingRequestsFor(groupId: number, userId: number): PendingRollRequest[] {
  return [...pending.values()].filter((r) => r.groupId === groupId && (r.targetUserId === userId || r.gmUserId === userId));
}

/**
 * Entfernt alle noch offenen Zweige einer Gruppen-Sammelanfrage (siehe
 * groupRolls.ts) und gibt sie zurück, damit die Aufruferin jedem Betroffenen
 * ein `roll.pending.cancelled` schicken kann — für den vorzeitigen Aufdecken/
 * Verwerfen der ganzen Anfrage.
 */
export function removePendingRequestsForGroup(groupRequestId: string): PendingRollRequest[] {
  const affected = [...pending.values()].filter((r) => r.groupRequestId === groupRequestId);
  for (const r of affected) removePendingRequest(r.id);
  return affected;
}
