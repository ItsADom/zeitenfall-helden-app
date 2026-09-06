// Open, self-serve Kooperationsprobe/Wettstreit pools — see
// shared/src/diceProtocol.ts's CoopPoolRequest doc comment for why this is a
// separate mechanism from groupRolls.ts's GM-broadcast Gruppenprobe: any
// player proposes, others join themselves, nobody rolls until the
// proposer/GM closes the pool. `mode` only decides the verdict computed at
// that point (ws.ts) — everything in this file is identical for both modes.
//
// In-memory only, like pendingRolls.ts/groupRolls.ts: a server restart drops
// an open pool. No TTL here (unlike those two) — closing is a deliberate
// manual action (roll.coop.start/roll.coop.cancel), not something that
// should expire out from under a slow-forming group.
import crypto from 'node:crypto';
import type { CoopPoolMember, CoopPoolRequest, PoolMode, ProbeSource } from 'shared';

const pools = new Map<string, CoopPoolRequest>();

export function createCoopPool(input: {
  groupId: number;
  source: ProbeSource;
  label: string;
  mode: PoolMode;
  initiatorUserId: number;
  initiatorName: string;
}): CoopPoolRequest {
  const request: CoopPoolRequest = {
    id: crypto.randomUUID(),
    groupId: input.groupId,
    source: input.source,
    label: input.label,
    mode: input.mode,
    initiatorUserId: input.initiatorUserId,
    initiatorName: input.initiatorName,
    members: [],
    createdAt: Date.now(),
  };
  pools.set(request.id, request);
  return request;
}

export function getCoopPool(id: string): CoopPoolRequest | undefined {
  return pools.get(id);
}

/** Offene Pools dieser Gruppe — beim (Wieder-)Verbinden an JEDEN nachgereicht (nicht nur die vorschlagende Person). */
export function coopPoolsFor(groupId: number): CoopPoolRequest[] {
  return [...pools.values()].filter((p) => p.groupId === groupId);
}

/** No-op (gibt den unveränderten Pool zurück), wenn dieser Charakter schon dabei ist. */
export function joinCoopPool(poolId: string, member: CoopPoolMember): CoopPoolRequest | null {
  const pool = pools.get(poolId);
  if (!pool) return null;
  if (!pool.members.some((m) => m.charId === member.charId)) pool.members.push(member);
  return pool;
}

export function leaveCoopPool(poolId: string, charId: number): CoopPoolRequest | null {
  const pool = pools.get(poolId);
  if (!pool) return null;
  pool.members = pool.members.filter((m) => m.charId !== charId);
  return pool;
}

/** Für roll.coop.start UND roll.coop.cancel — räumt den Pool weg und gibt ihn (mit den zuletzt beigetretenen Mitgliedern) zurück. */
export function removeCoopPool(poolId: string): CoopPoolRequest | null {
  const pool = pools.get(poolId);
  if (!pool) return null;
  pools.delete(poolId);
  return pool;
}
