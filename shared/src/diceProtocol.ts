// Wire types shared by client and server for the group feed (chat + dice
// rolls) WebSocket protocol and its REST history endpoint.

import type { DieConfirmation, DiceExpression, PendingConfirmation } from './dice.js';
import type { AttrRowCode, BaseValueKey } from './types.js';
import type { BoardClientMessage, BoardServerMessage } from './boardProtocol.js';

export type RollVisibility = 'public' | 'hidden' | 'gm_player';

// The client only ever sends WHICH Probe to roll — never a target number.
// The server recomputes it from the character's stored data (rules.ts),
// so a tampered client can't roll against an inflated threshold.
export type ProbeSource =
  // Eigenschaftsprobe: ein W20 gegen den Attributswert selbst. Schließt
  // Sozialstatus ein — auch darauf wird gewürfelt.
  | { kind: 'attribute'; attr: AttrRowCode }
  | { kind: 'talent'; talentId: number }
  // `weapon` ist nur nötig, wenn die Fähigkeit einen AT/PA/BL-Term führt
  // (siehe probeExprHasWeaponTerm in rules.ts) — 'row' eine echte Nahkampf-
  // waffe des Charakters, 'talent' Unbewaffnet (Raufen/Ringen), direkt über
  // die talents_catalog-id statt über eine Waffenzeile.
  | { kind: 'ability'; abilityId: number; weapon?: { kind: 'row'; sectionRowId: number } | { kind: 'talent'; talentId: number } }
  | { kind: 'sprache'; languageId: number; mode: 'sprechen' | 'schreiben' }
  | { kind: 'weapon'; sectionRowId: number; probe: 'at' | 'pa' | 'bl' | 'fk' }
  // Basiswert-Probe: ein W20 gegen den Basiswert selbst — Ausweichen (die
  // einzige Verteidigungsprobe ohne eigenen Waffen-Bezug) und Initiative.
  | { kind: 'baseValue'; key: Extract<BaseValueKey, 'ausweichen' | 'ini'> };

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
  /** Siehe RollFeedEntry.groupRollId. */
  groupRollId?: string;
  /** Siehe RollFeedEntry.coop. */
  coop?: true;
}

export interface ProbeRollPayload {
  mode: 'probe';
  source: ProbeSource;
  label: string;
  n: number;
  // probeZahl ist der reine, unveränderte Zielwert — `modifier` (die situative
  // Erleichterung/Erschwernis der Spielleitung) wirkt stattdessen auf die
  // GEWORFENE Summe (steckt bereits in adjustedSum, siehe shared/src/dice.ts).
  // Positiv erschwert (mehr auf der Summe, die unter probeZahl bleiben soll),
  // negativ erleichtert.
  probeZahl: number;
  modifier: number;
  dice: number[];
  /**
   * Welches Attribut (bzw. für 3-Würfel-Proben: welche drei) jeden Würfel
   * dieses Wurfs stellt, parallel zu `dice` — für die Attribut-Hervorhebung
   * bei einer stehengebliebenen 1/20 im Feed. Unbesetzt bei Waffenproben, die
   * keine direkte Attribut-Zuordnung je Würfel kennen.
   */
  attrParts?: AttrRowCode[];
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
  /**
   * „/master"/„/wild": ein serverseitig nachgeschlagener Ergebnistext (siehe
   * MASTER_TABLE/WILD_MAGIC_TABLE in shared/src/dice.ts), angezeigt an der
   * Stelle, an der eine Probe „Erfolg"/„Fehlschlag" zeigen würde. Unbesetzt
   * bei einem gewöhnlichen freien Wurf.
   */
  outcomeLabel?: string;
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
  /**
   * Gesetzt, wenn dieser Eintrag Teil einer aufgelösten Gruppen-Sammelanfrage
   * ist (siehe GroupRollRequest.id) — mehrere Einträge mit derselben id
   * gehören zusammen. Rein fürs Feed-Rendering (ein gemeinsamer, farbiger
   * Rand statt je Eintrag einzeln, siehe FeedEntryView): welcher Wurf
   * gelungen/misslungen ist, steht ohnehin schon rechts am Eintrag.
   */
  groupRollId?: string;
  /**
   * Gesetzt auf JEDEM Eintrag einer aufgelösten Kooperationsprobe (siehe
   * coopPools.ts) — unterscheidet einen Kooperations-Block von einer
   * gewöhnlichen Gruppenprobe, die denselben groupRollId-Mechanismus nutzt.
   * DicePanel.tsx rendert bei `coop: true` zusätzlich eine gepoolte
   * Verdikt-Zeile über den einzelnen Würfen (computeCoopVerdict).
   */
  coop?: true;
}

export type FeedEntry = ChatFeedEntry | RollFeedEntry;

/**
 * Everything a client needs for ONE performance of the „großer Wurf" (see
 * roll.expr.important and shared/src/diceCinematic.ts).
 */
export interface KinoAuftrag {
  /**
   * Drives the whole animation. The same number on every screen, therefore the
   * same performance everywhere — flight paths, tumble axes, spark directions.
   * Never the RESULT: the server rolls that exactly as it always does (see
   * server/src/dice.ts).
   */
  seed: number;
  /**
   * The finished, already-persisted entry.
   *
   * It travels HERE rather than arriving via `feed.append`, because it may only
   * surface in the chat AFTER the performance — every client appends it itself
   * once its own cinematic is done (skipped, timed out, or run to the end). It
   * therefore also carries everything the overlay shows: two sources for text
   * that appears twice on screen seconds apart would drift sooner or later.
   *
   * Always `visibility: 'public'` — see roll.expr.important.
   */
  entry: RollFeedEntry;
}

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
  /**
   * Von der Spielleitung bei der Anfrage gesetzt (situative Erleichterung/
   * Erschwernis) — ersetzt beim Annehmen den eigenen Modifikator des Spielers
   * vollständig, statt sich dazuzuaddieren (siehe roll.pending.accept in
   * ws.ts). Ungesetzt = die Spielleitung hat keinen vorgegeben, der Spieler
   * würfelt mit seinem eigenen (wie bisher).
   */
  modifier?: number;
  /**
   * Gesetzt, wenn diese Anfrage EIN Zweig einer Gruppen-Sammelanfrage ist
   * (siehe `roll.group.request`) — alle Zweige derselben Anfrage teilen diese
   * id. Annehmen/Ablehnen läuft für den Spieler genauso wie bei einer
   * einzelnen Anfrage; das Ergebnis wird serverseitig nur zurückgehalten, bis
   * die ganze Gruppe geantwortet hat (oder die Spielleitung vorzeitig
   * aufdeckt — siehe `roll.group.reveal`).
   */
  groupRequestId?: string;
  createdAt: number;
  expiresAt: number;
}

export interface GroupRollMember {
  userId: number;
  charId: number;
  charName: string;
  /**
   * Live-Stand für die Spielleitungs-Karte: `waiting` bis der Zweig
   * beantwortet ist, dann `rolled`/`passed` — bleibt aber Teil der Liste
   * (verschwindet NICHT), damit die Spielleitung sieht, wer schon dran war,
   * statt dass Karten einfach verschwinden. Nur `waiting` bei der Erstellung
   * (`roll.group.request`); `roll.group.member` aktualisiert den Rest.
   */
  status: 'waiting' | 'rolled' | 'passed';
}

/**
 * A group-wide roll request — the Spielleitung asked everyone currently
 * connected to roll the same Probe. Purely informational on the wire (there
 * is no dedicated "group request" card): each `members` entry additionally
 * gets its own ordinary `PendingRollRequest` (tagged with this id via
 * `groupRequestId`), so the existing accept/decline UI needs no changes.
 * `members` is the roster PendingRequestCard shows to the Spielleitung while
 * waiting.
 */
export interface GroupRollRequest {
  id: string;
  groupId: number;
  source: ProbeSource;
  label: string;
  gmUserId: number;
  gmName: string;
  members: GroupRollMember[];
  createdAt: number;
  expiresAt: number;
}

export interface CoopPoolMember {
  userId: number;
  charId: number;
  charName: string;
}

/**
 * An open, self-serve Kooperationsprobe pool (see coopPools.ts) — different
 * shape from GroupRollRequest on purpose: ANY player (GM included) can
 * propose one, and other members join themselves rather than being pushed a
 * targeted PendingRollRequest each. Nobody rolls until the proposer or the
 * GM closes the pool (`roll.coop.start`) — `members` is just "who's in" up
 * to that point, no per-member roll/pass status to track before then.
 */
export interface CoopPoolRequest {
  id: string;
  groupId: number;
  source: ProbeSource;
  label: string;
  initiatorUserId: number;
  initiatorName: string;
  /** Join order. */
  members: CoopPoolMember[];
  createdAt: number;
}

// Every client→server message carries reqId so the UI can correlate an
// error reply back to the control that sent it.
export type ClientToServerMessage =
  // visibility/targetUserId: same VisibilityPicker the dock uses for rolls —
  // an ordinary chat line defaulted to 'public' regardless of the picker
  // (see ws.ts); now it carries the same setting a roll would.
  | {
      type: 'chat.send';
      reqId: string;
      text: string;
      isMe: boolean;
      charId: number | null;
      visibility?: RollVisibility;
      targetUserId?: number;
    }
  // `table`: „/master"/„/wild" — der Server würfelt die dazu passenden
  // Würfel und den Ergebnistext selbst (siehe ws.ts), `expression`/`label`
  // werden dann ignoriert. Nie vom Client übernommen, aus demselben Grund
  // wie probeZahl: sonst könnte ein manipulierter Client sich ein Ergebnis
  // aussuchen.
  // targetUserId: nur bei visibility 'gm_player' UND von der Spielleitung
  // gesendet — welches Gruppenmitglied den Wurf zusätzlich sieht. Von einem
  // Spieler gesendet, ist das Gegenstück stattdessen die (einzige) gerade
  // verbundene Spielleitung, serverseitig aufgelöst (siehe ws.ts) — ein
  // Spieler kann das Gegenüber nicht selbst wählen.
  | {
      type: 'roll.expr';
      reqId: string;
      label: string;
      expression: string;
      visibility: RollVisibility;
      charId: number | null;
      table?: 'master' | 'wild';
      targetUserId?: number;
      /**
       * „/i" — the roll is announced to the whole table (fanfare, dimmed
       * screen, falling dice) before it appears in the chat. Spielleitung only;
       * the server rejects it otherwise.
       *
       * Forces `visibility: 'public'` and ignores `targetUserId` — an
       * announcement to everyone with a hidden result behind it would make no
       * sense. Never combined with `table`.
       */
      important?: true;
    }
  // modifier: situative Erleichterung(-)/Erschwernis(+) der Spielleitung, vom
  // Spieler selbst eingetragen (Dock, neben VisibilityPicker) — wirkt auf die
  // geworfene Summe, nicht auf probeZahl (siehe shared/src/dice.ts). Der
  // Server klemmt sie auf einen vernünftigen Bereich, siehe ws.ts.
  | {
      type: 'roll.probe';
      reqId: string;
      source: ProbeSource;
      charId: number;
      visibility: RollVisibility;
      modifier?: number;
      targetUserId?: number;
    }
  // Einen offenen Bestätigungswurf erledigen: werfen, oder mit skip:true
  // verwerfen (nicht jeder W20-Wurf kennt Patzer). Nur der Werfer selbst.
  | { type: 'roll.confirm'; reqId: string; entryId: number; dieIndex: number; skip?: boolean }
  | { type: 'roll.pending.request'; reqId: string; source: ProbeSource; targetUserId: number; targetCharId: number; modifier?: number }
  | { type: 'roll.pending.accept'; reqId: string; requestId: string; modifier?: number }
  | { type: 'roll.pending.decline'; reqId: string; requestId: string }
  // Nur die Spielleitung, und nur für eine Anfrage, die sie selbst gestellt
  // hat — Gegenstück zu roll.pending.decline (das ist der Spieler-Seite
  // vorbehalten).
  | { type: 'roll.pending.cancel'; reqId: string; requestId: string }
  // Fragt dieselbe Probe bei JEDEM gerade verbundenen Gruppenmitglied an
  // (außer der Spielleitung selbst) — server-seitig ein `roll.pending.request`
  // je Mitglied unter einer gemeinsamen groupRequestId, siehe dort.
  | { type: 'roll.group.request'; reqId: string; source: ProbeSource; modifier?: number }
  // Deckt eine Gruppen-Sammelanfrage vorzeitig auf: noch offene Zweige werden
  // verworfen (wie roll.pending.cancel), bereits zurückgehaltene Ergebnisse
  // sofort veröffentlicht. Nur die anfragende Spielleitung.
  | { type: 'roll.group.reveal'; reqId: string; groupRequestId: string }
  // Verwirft die ganze Sammelanfrage — auch bereits zurückgehaltene, aber noch
  // nicht veröffentlichte Ergebnisse. Nur die anfragende Spielleitung.
  | { type: 'roll.group.cancel'; reqId: string; groupRequestId: string }
  // Kooperationsprobe: schlägt einen offenen, für alle sichtbaren Pool vor —
  // Gegenstück zu roll.group.request, aber selbstbedient statt SL-Broadcast,
  // und JEDER (nicht nur die Spielleitung) darf vorschlagen — auch OHNE
  // eigenen Charakter (die Spielleitung hat nie einen), da Vorschlagen nicht
  // automatisch beitritt. Der Server sucht sich fürs Anzeige-Label selbst
  // irgendeinen Charakter der Gruppe (siehe ws.ts).
  | { type: 'roll.coop.propose'; reqId: string; source: ProbeSource }
  // Tritt einem offenen Pool bei / verlässt ihn wieder — jeder für sich
  // selbst, mit dem eigenen Charakter dieser Gruppe.
  | { type: 'roll.coop.join'; reqId: string; poolId: string; charId: number }
  | { type: 'roll.coop.leave'; reqId: string; poolId: string }
  // Schließt den Pool: alle beigetretenen Mitglieder würfeln jetzt gemeinsam
  // (siehe ws.ts). Nur die vorschlagende Person oder die Spielleitung.
  | { type: 'roll.coop.start'; reqId: string; poolId: string }
  // Verwirft den Pool ohne zu würfeln. Nur die vorschlagende Person oder die
  // Spielleitung.
  | { type: 'roll.coop.cancel'; reqId: string; poolId: string }
  // Virtueller Tisch (docs/concepts/virtual-table.md) — rides this same
  // socket rather than a second connection, see boardProtocol.ts.
  | BoardClientMessage;

export type ServerToClientMessage =
  | { type: 'feed.append'; entry: FeedEntry }
  // Ein bestehender Eintrag hat sich geändert (Bestätigungswurf nachgereicht).
  | { type: 'feed.update'; entry: FeedEntry }
  | { type: 'roll.pending.created'; request: PendingRollRequest }
  | { type: 'roll.pending.expired'; requestId: string }
  | { type: 'roll.pending.declined'; requestId: string }
  | { type: 'roll.pending.accepted'; requestId: string }
  | { type: 'roll.pending.cancelled'; requestId: string }
  // Gruppen-Sammelanfrage, nur an die anfragende Spielleitung: EINE Karte mit
  // der ganzen Mitgliederliste statt eines Zweigs je `roll.pending.created`.
  | { type: 'roll.group.created'; request: GroupRollRequest }
  // Ein Zweig ist beantwortet — die Karte bleibt stehen, nur der Status
  // dieses Mitglieds ändert sich (siehe GroupRollMember.status).
  | { type: 'roll.group.member'; requestId: string; charId: number; status: 'rolled' | 'passed' }
  // Alles ist veröffentlicht (vollständig oder per roll.group.reveal
  // vorzeitig) — die Karte darf verschwinden.
  | { type: 'roll.group.revealed'; requestId: string }
  | { type: 'roll.group.cancelled'; requestId: string }
  // Kooperationsprobe: an ALLE in der Gruppe (nicht nur eine Seite) — jeder
  // soll den offenen Pool sehen und beitreten können.
  | { type: 'roll.coop.created'; pool: CoopPoolRequest }
  | { type: 'roll.coop.updated'; pool: CoopPoolRequest }
  | { type: 'roll.coop.closed'; poolId: string }
  | { type: 'roll.coop.cancelled'; poolId: string }
  // GM-Reset (Einzeln oder „Neuer Spieltag") passiert über REST auf der
  // GM-Übersicht, nicht über dieses Socket — ohne diesen Push bliebe der
  // Klee-Zähler in der Spieler-Session stumpf bis zum nächsten Laden.
  | { type: 'schicksalspunkte.update'; charId: number; aktuell: number; max: number }
  // Nur an die eben verbundene Socket selbst — wer sonst gerade in diesem
  // Raum verbunden ist, im Moment des Verbindens. Rein lokal/clientseitig zu
  // zeigen (siehe DicePanelProvider): kein Feed-Eintrag, nicht persistiert,
  // niemand sonst bekommt diese Nachricht.
  | { type: 'presence.snapshot'; names: string[] }
  // An alle SCHON verbundenen Sockets im Raum, wenn ein weiterer Nutzer neu
  // dazukommt — ausgenommen ein bloßes Reconnect-Aufflackern kurz nach dem
  // eigenen Verbindungsabbruch (siehe RECONNECT_GRACE_MS in ws.ts). Wie
  // presence.snapshot rein lokal, kein Feed-Eintrag.
  | { type: 'presence.joined'; name: string }
  // A „großer Wurf" („/i") has been announced: to EVERYONE in the room,
  // unfiltered.
  //
  // Like presence.snapshot and wartung.angekuendigt, a pure LIVE event — not
  // persisted, never replayed. Whoever connects afterwards sees the roll in the
  // history like any other, but no cinematic. That split between "live" and
  // "history" is exactly why this is its own message rather than a field on the
  // entry: a stored flag would replay the performance on every page load.
  //
  // The entry rides along here instead of via feed.append — see
  // KinoAuftrag.entry.
  | ({ type: 'roll.important' } & KinoAuftrag)
  // The one message that goes to EVERY room rather than one: an admin has
  // triggered a redeploy, so this instance will restart shortly. Receiving it
  // is what licenses a client to show the waiting screen when the connection
  // later drops — the dock reconnects after any blip on its own, so a dropped
  // socket alone would pop the screen up on every Wi-Fi hiccup.
  | { type: 'wartung.angekuendigt'; durch: string }
  | { type: 'ack'; reqId: string }
  | { type: 'error'; reqId: string; message: string }
  | BoardServerMessage;
