// Wire types shared by client and server for the group feed (chat + dice
// rolls) WebSocket protocol and its REST history endpoint.

import type { DieConfirmation, DiceExpression, PendingConfirmation } from './dice.js';
import type { AttrRowCode } from './types.js';

export type RollVisibility = 'public' | 'hidden' | 'gm_player';

// The client only ever sends WHICH Probe to roll — never a target number.
// The server recomputes it from the character's stored data (rules.ts),
// so a tampered client can't roll against an inflated threshold.
export type ProbeSource =
  // Eigenschaftsprobe: ein W20 gegen den Attributswert selbst. Schließt
  // Sozialstatus ein — auch darauf wird gewürfelt.
  | { kind: 'attribute'; attr: AttrRowCode }
  | { kind: 'talent'; talentId: number }
  | { kind: 'ability'; abilityId: number }
  | { kind: 'sprache'; languageId: number; mode: 'sprechen' | 'schreiben' }
  | { kind: 'weapon'; sectionRowId: number; probe: 'at' | 'pa' | 'bl' | 'fk' };

export interface ChatFeedEntry {
  id: number;
  kind: 'message';
  createdAt: number;
  visibility: RollVisibility;
  authorUserId: number | null;
  authorCharId: number | null;
  gmUserId: number | null;
  authorName: string;
  isMe: boolean;
  text: string;
}

export interface ProbeRollPayload {
  mode: 'probe';
  source: ProbeSource;
  label: string;
  n: number;
  probeZahl: number;
  dice: number[];
  confirmations: DieConfirmation[];
  // Offene Bestätigungswürfe — der Spieler löst sie einzeln aus, erst danach
  // steht das Ergebnis fest (resolved).
  pending: PendingConfirmation[];
  resolved: boolean;
  rawSum: number;
  adjustedSum: number;
  criticalFailureCount: number;
  criticalFailure: boolean;
  success: boolean;
  /** Bestanden, aber nur knapp — siehe NARROW_PASS_MARGIN. */
  narrow: boolean;
  /** Sauber bestanden mit stehengebliebener 1 — Gegenstück zum Patzer. */
  criticalSuccess: boolean;
}

export interface ExpressionRollPayload {
  mode: 'expr';
  label: string;
  expression: DiceExpression;
  dice: number[];
  confirmations: DieConfirmation[];
  pending: PendingConfirmation[];
  resolved: boolean;
  rawSum: number;
  adjustedSum: number;
  flagged: boolean;
}

export type RollPayload = ProbeRollPayload | ExpressionRollPayload;

export interface RollFeedEntry {
  id: number;
  kind: 'roll';
  createdAt: number;
  visibility: RollVisibility;
  authorUserId: number | null;
  authorCharId: number | null;
  gmUserId: number | null;
  authorName: string;
  roll: RollPayload;
}

export type FeedEntry = ChatFeedEntry | RollFeedEntry;

export interface PendingRollRequest {
  id: string;
  groupId: number;
  source: ProbeSource;
  label: string;
  gmUserId: number;
  gmName: string;
  targetUserId: number;
  targetCharId: number;
  /** Angezeigt bei der Spielleitung, die auf mehrere Antworten warten kann. */
  targetCharName: string;
  createdAt: number;
  expiresAt: number;
}

// Every client→server message carries reqId so the UI can correlate an
// error reply back to the control that sent it.
export type ClientToServerMessage =
  | { type: 'chat.send'; reqId: string; text: string; isMe: boolean; charId: number | null }
  | { type: 'roll.expr'; reqId: string; label: string; expression: string; visibility: RollVisibility; charId: number | null }
  | { type: 'roll.probe'; reqId: string; source: ProbeSource; charId: number; visibility: 'public' | 'hidden' }
  // Einen offenen Bestätigungswurf erledigen: werfen, oder mit skip:true
  // verwerfen (nicht jeder W20-Wurf kennt Patzer). Nur der Werfer selbst.
  | { type: 'roll.confirm'; reqId: string; entryId: number; dieIndex: number; skip?: boolean }
  | { type: 'roll.pending.request'; reqId: string; source: ProbeSource; targetUserId: number; targetCharId: number }
  | { type: 'roll.pending.accept'; reqId: string; requestId: string }
  | { type: 'roll.pending.decline'; reqId: string; requestId: string };

export type ServerToClientMessage =
  | { type: 'feed.append'; entry: FeedEntry }
  // Ein bestehender Eintrag hat sich geändert (Bestätigungswurf nachgereicht).
  | { type: 'feed.update'; entry: FeedEntry }
  | { type: 'roll.pending.created'; request: PendingRollRequest }
  | { type: 'roll.pending.expired'; requestId: string }
  | { type: 'roll.pending.declined'; requestId: string }
  | { type: 'ack'; reqId: string }
  | { type: 'error'; reqId: string; message: string };
