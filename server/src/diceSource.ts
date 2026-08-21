// Canonical, server-side recompute of a Probe's target number (probeZahl)
// and die count (n) from a character's stored attributes/TaW/weapon data.
// The client only ever sends WHICH Probe to roll (a ProbeSource) — never a
// number — so a tampered client can't roll against an inflated threshold.
import type { AttrCode, AttrRowCode, ProbeSource } from 'shared';
import {
  ATTR_ROW_CODES,
  ATTR_LABELS,
  attrMax,
  BASE_VALUE_LABELS,
  computeBaseValues,
  erleichterung,
  parseProbeExpr,
  probeExprZahl,
  schreibenProbe,
  sprechenProbe,
  talentProbeZahl,
  weaponProbe,
} from 'shared';
import { db } from './db.js';
import { loadAttributes, loadBaseValueInputs } from './characterData.js';

export interface ComputedProbe {
  n: number;
  probeZahl: number;
  label: string;
  /** Welches Attribut jeden Würfel stellt — siehe ProbeRollPayload.attrParts. */
  attrParts?: AttrRowCode[];
}

// Der Client schickt nur, WELCHE Probe gewürfelt werden soll — hier wird das
// rohe JSON auf eine der vier bekannten Formen eingegrenzt, bevor irgendetwas
// damit an die Datenbank geht.
export function parseProbeSource(raw: unknown): ProbeSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const id = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  switch (s.kind) {
    case 'attribute': {
      // Alle neun Zeilen der Attributstabelle, Sozialstatus eingeschlossen.
      return ATTR_ROW_CODES.includes(s.attr as AttrRowCode) ? { kind: 'attribute', attr: s.attr as AttrRowCode } : null;
    }
    case 'talent': {
      const talentId = id(s.talentId);
      return talentId ? { kind: 'talent', talentId } : null;
    }
    case 'ability': {
      const abilityId = id(s.abilityId);
      return abilityId ? { kind: 'ability', abilityId } : null;
    }
    case 'sprache': {
      const languageId = id(s.languageId);
      if (!languageId) return null;
      if (s.mode !== 'sprechen' && s.mode !== 'schreiben') return null;
      return { kind: 'sprache', languageId, mode: s.mode };
    }
    case 'weapon': {
      const sectionRowId = id(s.sectionRowId);
      if (!sectionRowId) return null;
      if (s.probe !== 'at' && s.probe !== 'pa' && s.probe !== 'bl' && s.probe !== 'fk') return null;
      return { kind: 'weapon', sectionRowId, probe: s.probe };
    }
    case 'baseValue': {
      return s.key === 'ausweichen' ? { kind: 'baseValue', key: 'ausweichen' } : null;
    }
    default:
      return null;
  }
}

export function computeProbeForCharacter(characterId: number, source: ProbeSource): ComputedProbe | null {
  const attrs = loadAttributes(characterId);
  switch (source.kind) {
    case 'attribute': {
      // Eigenschaftsprobe: ein einzelner W20 gegen den Attributswert
      // (Basis + Bonus, wie auf dem Bogen in der Max-Spalte).
      return { n: 1, probeZahl: attrMax(attrs, source.attr), label: ATTR_LABELS[source.attr], attrParts: [source.attr] };
    }
    case 'talent': {
      const row = db
        // Vom KATALOG aus, nicht von char_talents: der Bogen zeigt für jedes
        // Talent eine Probe-Zahl, auch für ungelernte (kein char_talents-
        // Eintrag = TaW 0). Ein Wurf darauf ist ein regulärer ungelernter
        // Versuch und muss möglich sein.
        .prepare(
          `SELECT tc.probe, tc.name, COALESCE(ct.taw, 0) AS taw
           FROM talents_catalog tc
           LEFT JOIN char_talents ct ON ct.talent_id = tc.id AND ct.character_id = ?
           WHERE tc.id = ?`,
        )
        .get(characterId, source.talentId) as { taw: number; probe: string; name: string } | undefined;
      // Kampftalente haben keine Formel — sie werden über den Waffen-Reiter gewürfelt.
      if (!row || !row.probe) return null;
      const parts = row.probe.split('/').map((p) => p.trim().toUpperCase());
      if (parts.length !== 3) return null;
      const probeZahl = talentProbeZahl(attrs, parts as [AttrCode, AttrCode, AttrCode], row.taw);
      return { n: 3, probeZahl, label: row.name, attrParts: parts as AttrCode[] };
    }
    case 'ability': {
      const row = db
        .prepare('SELECT name, probe FROM char_abilities WHERE character_id = ? AND id = ?')
        .get(characterId, source.abilityId) as { name: string; probe: string } | undefined;
      if (!row) return null;
      const parts = parseProbeExpr(row.probe);
      const probeZahl = probeExprZahl(attrs, row.probe);
      if (!parts || probeZahl === null) return null;
      return { n: parts.length, probeZahl, label: row.name, attrParts: parts };
    }
    case 'sprache': {
      const row = db
        // Wie bei den Talenten vom Katalog aus — eine nicht gelernte Sprache
        // (kein char_languages-Eintrag) ist mit TaW 0 trotzdem würfelbar.
        .prepare(
          `SELECT lc.name, COALESCE(cl.taw, 0) AS taw
           FROM languages_catalog lc
           LEFT JOIN char_languages cl ON cl.language_id = lc.id AND cl.character_id = ?
           WHERE lc.id = ?`,
        )
        .get(characterId, source.languageId) as { taw: number; name: string } | undefined;
      if (!row) return null;
      const base = source.mode === 'sprechen' ? sprechenProbe(attrs) : schreibenProbe(attrs);
      const probeZahl = base + erleichterung(row.taw);
      const modeLabel = source.mode === 'sprechen' ? 'Sprechen' : 'Schreiben';
      const attrParts: AttrCode[] = source.mode === 'sprechen' ? ['KL', 'IN', 'CH'] : ['KL', 'KL', 'FF'];
      return { n: 3, probeZahl, label: `${row.name} (${modeLabel})`, attrParts };
    }
    case 'weapon': {
      const table = source.probe === 'fk' ? 'sec_waffenFernNeu' : 'sec_waffenNahNeu';
      const row = db.prepare(`SELECT * FROM ${table} WHERE character_id = ? AND id = ?`).get(characterId, source.sectionRowId) as
        | Record<string, unknown>
        | undefined;
      if (!row) return null;
      const talentId = Number(row.talentId) || 0;
      const talent = db
        .prepare('SELECT at, pa, bl FROM char_talents WHERE character_id = ? AND talent_id = ?')
        .get(characterId, talentId) as { at: number; pa: number; bl: number } | undefined;
      const bv = computeBaseValues(attrs, loadBaseValueInputs(characterId));
      const label = String(row.typ ?? '');
      if (source.probe === 'fk') {
        const probeZahl = weaponProbe(Number(row.atMod) || 0, bv.fk.ergebnis, talent?.at ?? 0);
        return { n: 1, probeZahl, label: `${label} (FK)` };
      }
      const weaponMod = Number(row[source.probe]) || 0;
      const baseErgebnis = bv[source.probe].ergebnis;
      const talentSplit = talent?.[source.probe] ?? 0;
      const probeZahl = weaponProbe(weaponMod, baseErgebnis, talentSplit);
      return { n: 1, probeZahl, label: `${label} (${source.probe.toUpperCase()})` };
    }
    case 'baseValue': {
      const bv = computeBaseValues(attrs, loadBaseValueInputs(characterId));
      return { n: 1, probeZahl: bv[source.key].ergebnis, label: BASE_VALUE_LABELS[source.key].label };
    }
    default:
      return null;
  }
}

export interface RollableProbe {
  source: ProbeSource;
  label: string;
  n: number;
  probeZahl: number;
  /** Grobe Einordnung für die Gruppierung in der Auswahlliste. */
  kind: 'attribute' | 'talent' | 'ability' | 'sprache' | 'weapon' | 'baseValue';
}

/**
 * Alles, worauf dieser Charakter würfeln kann — für die Auswahlliste der
 * Spielleitung („Probe anfordern"). Der Charakterbogen braucht das nicht, der
 * hat seine Zahlen schon; deshalb wird die Liste auch nur auf Anfrage gebaut
 * und nicht in die Übersicht mitgeladen.
 */
export function listRollableProbes(characterId: number): RollableProbe[] {
  const out: RollableProbe[] = [];
  const add = (source: ProbeSource, kind: RollableProbe['kind']) => {
    const computed = computeProbeForCharacter(characterId, source);
    if (computed) out.push({ source, kind, label: computed.label, n: computed.n, probeZahl: computed.probeZahl });
  };

  for (const attr of ATTR_ROW_CODES) add({ kind: 'attribute', attr }, 'attribute');
  add({ kind: 'baseValue', key: 'ausweichen' }, 'baseValue');

  // Talente/Sprachen aus dem KATALOG (auch ungelernte sind würfelbar, siehe
  // computeProbeForCharacter) — Kampftalente fallen dort mangels Formel raus.
  const talents = db.prepare('SELECT id FROM talents_catalog ORDER BY sort, name').all() as { id: number }[];
  for (const t of talents) add({ kind: 'talent', talentId: t.id }, 'talent');

  const abilities = db.prepare('SELECT id FROM char_abilities WHERE character_id = ? ORDER BY pos, id').all(characterId) as {
    id: number;
  }[];
  for (const a of abilities) add({ kind: 'ability', abilityId: a.id }, 'ability');

  const languages = db.prepare('SELECT id, kind FROM languages_catalog ORDER BY sort, name').all() as {
    id: number;
    kind: string;
  }[];
  for (const l of languages) {
    add({ kind: 'sprache', languageId: l.id, mode: l.kind === 'schrift' ? 'schreiben' : 'sprechen' }, 'sprache');
  }

  const nah = db.prepare('SELECT id FROM sec_waffenNahNeu WHERE character_id = ? ORDER BY pos, id').all(characterId) as {
    id: number;
  }[];
  for (const w of nah) {
    for (const probe of ['at', 'pa', 'bl'] as const) add({ kind: 'weapon', sectionRowId: w.id, probe }, 'weapon');
  }
  const fern = db.prepare('SELECT id FROM sec_waffenFernNeu WHERE character_id = ? ORDER BY pos, id').all(characterId) as {
    id: number;
  }[];
  for (const w of fern) add({ kind: 'weapon', sectionRowId: w.id, probe: 'fk' }, 'weapon');

  return out;
}
