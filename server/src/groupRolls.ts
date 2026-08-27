// Group-wide roll requests: the Spielleitung asks the whole (currently
// connected) group to roll the same Probe at once, and results only publish
// to the feed once everyone has responded — rolled or passed.
//
// Built on TOP of pendingRolls.ts, not instead of it: each targeted member
// gets their own ordinary PendingRollRequest (see ws.ts's 'roll.group.request'
// handler), just tagged with a shared groupRequestId. Accepting/declining is
// unchanged from the player's side; this module only tracks, per
// groupRequestId, which members have answered and what to reveal once
// everyone has — the actual DB/feed writes stay in ws.ts, alongside the
// existing single-request accept/decline handlers.
//
// In-memory only, like pendingRolls.ts: a server restart drops an open group
// request, the Spielleitung asks again.
import crypto from 'node:crypto';
import type { FeedAuthor } from './feed.js';
import type { GroupRollRequest, ProbeRollPayload, ProbeSource } from 'shared';

export const GROUP_TTL_MS = 5 * 60 * 1000;

export type HeldResult = { kind: 'roll'; author: FeedAuthor; roll: ProbeRollPayload } | { kind: 'passed'; author: FeedAuthor };

interface GroupState {
  request: GroupRollRequest;
  /** charIds, in request order — reveal walks this so the feed reads top to bottom by roster order. */
  order: number[];
  /** Noch nicht beantwortet. */
  open: Set<number>;
  held: Map<number, HeldResult>;
  timer: ReturnType<typeof setTimeout>;
}

const groups = new Map<string, GroupState>();

export function createGroupRollRequest(input: {
  groupId: number;
  source: ProbeSource;
  label: string;
  gmUserId: number;
  gmName: string;
  members: { userId: number; charId: number; charName: string }[];
  onExpire: (state: { request: GroupRollRequest; held: Map<number, HeldResult>; order: number[] }) => void;
}): GroupRollRequest {
  const now = Date.now();
  const request: GroupRollRequest = {
    id: crypto.randomUUID(),
    groupId: input.groupId,
    source: input.source,
    label: input.label,
    gmUserId: input.gmUserId,
    gmName: input.gmName,
    members: input.members.map((m) => ({ ...m, status: 'waiting' })),
    createdAt: now,
    expiresAt: now + GROUP_TTL_MS,
  };
  const timer = setTimeout(() => {
    const state = groups.get(request.id);
    if (state) {
      groups.delete(request.id);
      input.onExpire(state);
    }
  }, GROUP_TTL_MS);
  timer.unref?.();
  groups.set(request.id, {
    request,
    order: input.members.map((m) => m.charId),
    open: new Set(input.members.map((m) => m.charId)),
    held: new Map(),
    timer,
  });
  return request;
}

export function getGroupRollRequest(id: string): GroupRollRequest | undefined {
  return groups.get(id)?.request;
}

/**
 * Offene Sammelanfragen, an denen dieser Nutzer beteiligt ist (als
 * Spielleitung ODER als angefragtes Mitglied) — beim (Wieder-)Verbinden
 * nachgereicht. Vor „players see the roster too" nur die Spielleitung.
 */
export function groupRollRequestsFor(groupId: number, userId: number): GroupRollRequest[] {
  return [...groups.values()]
    .map((s) => s.request)
    .filter((r) => r.groupId === groupId && (r.gmUserId === userId || r.members.some((m) => m.userId === userId)));
}

/**
 * Ein Zweig ist beantwortet — hält das Ergebnis zurück. Gibt die volle
 * Sammlung zurück, wenn damit ALLE geantwortet haben (Aufruferin veröffentlicht
 * dann und räumt auf), sonst null.
 */
export function holdGroupResult(
  groupRequestId: string,
  charId: number,
  result: HeldResult,
): { order: number[]; held: Map<number, HeldResult> } | null {
  const state = groups.get(groupRequestId);
  if (!state || !state.open.has(charId)) return null;
  state.open.delete(charId);
  state.held.set(charId, result);
  if (state.open.size > 0) return null;
  clearTimeout(state.timer);
  groups.delete(groupRequestId);
  return { order: state.order, held: state.held };
}

/** Ein einzelner Zweig fällt weg (Ablauf oder GM-Cancel dieses EINEN Mitglieds), ohne die übrigen zu blockieren. */
export function dropGroupMember(
  groupRequestId: string,
  charId: number,
): { order: number[]; held: Map<number, HeldResult> } | null {
  const state = groups.get(groupRequestId);
  if (!state) return null;
  state.open.delete(charId);
  if (state.open.size > 0) return null;
  clearTimeout(state.timer);
  groups.delete(groupRequestId);
  return { order: state.order, held: state.held };
}

/** Deckt sofort auf, was schon da ist — der Rest (noch offen) wird verworfen. Immer „vollständig". */
export function forceRevealGroup(groupRequestId: string): { order: number[]; held: Map<number, HeldResult> } | null {
  const state = groups.get(groupRequestId);
  if (!state) return null;
  clearTimeout(state.timer);
  groups.delete(groupRequestId);
  return { order: state.order, held: state.held };
}

/** Verwirft die ganze Anfrage — auch schon zurückgehaltene Ergebnisse, nichts wird veröffentlicht. */
export function cancelGroupRollRequest(groupRequestId: string): GroupRollRequest | null {
  const state = groups.get(groupRequestId);
  if (!state) return null;
  clearTimeout(state.timer);
  groups.delete(groupRequestId);
  return state.request;
}
