// Canonical, server-side recompute of a Probe's target number (probeZahl)
// and die count (n) from a character's stored attributes/TaW/weapon data.
// The client only ever sends WHICH Probe to roll (a ProbeSource) — never a
// number — so a tampered client can't roll against an inflated threshold.
import type { AttrCode, AttrRowCode, Attributes, ProbeSource } from 'shared';
import {
  ATTR_ROW_CODES,
  ATTR_LABELS,
  abilityProbeZahl,
  attrMax,
  BASE_VALUE_LABELS,
  computeBaseValues,
  erleichterung,
  parseProbeExpr,
  probeExprZahl,
  schreibenProbe,
  sprechenProbe,
  talentProbeBonus,
  talentProbeZahl,
  weaponProbe,
  weaponProbes,
} from 'shared';
import { waffenStatWert, waffenStatZahl } from 'shared';
import { db } from './db.js';
import { loadItems, loadStats } from './characterData.js';
import type { CharStats } from './characterData.js';

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
      if (!abilityId) return null;
      const w = s.weapon as Record<string, unknown> | undefined;
      if (!w) return { kind: 'ability', abilityId };
      if (w.kind === 'item') {
        const itemId = id(w.itemId);
        return itemId ? { kind: 'ability', abilityId, weapon: { kind: 'item', itemId } } : null;
      }
      if (w.kind === 'talent') {
        const talentId = id(w.talentId);
        return talentId ? { kind: 'ability', abilityId, weapon: { kind: 'talent', talentId } } : null;
      }
      return null;
    }
    case 'sprache': {
      const languageId = id(s.languageId);
      if (!languageId) return null;
      if (s.mode !== 'sprechen' && s.mode !== 'schreiben') return null;
      return { kind: 'sprache', languageId, mode: s.mode };
    }
    case 'weapon': {
      const itemId = id(s.itemId);
      if (!itemId) return null;
      if (s.probe !== 'at' && s.probe !== 'pa' && s.probe !== 'bl' && s.probe !== 'fk') return null;
      return { kind: 'weapon', itemId, probe: s.probe };
    }
    case 'baseValue': {
      return s.key === 'ausweichen' || s.key === 'ini' ? { kind: 'baseValue', key: s.key } : null;
    }
    default:
      return null;
  }
}

// AT/PA/BL-Term einer Fähigkeiten-Probe: entweder eine echte Nahkampfwaffe
// (talentId + Waffen-Bonus aus deren waffenStats, seit "Weapons become real
// items" ein char_items-Eintrag mit waffenArt: 'nah') oder Unbewaffnet —
// direkt über eine talents_catalog-id (Raufen/Ringen), ohne Waffe, Waffen-
// Bonus dann 0. Beide Fälle rechnen über dieselbe weaponProbes()-Formel wie
// der Waffen-Reiter, mit der AT/PA/BL-SPALTE des Talents (char_talents.at/
// pa/bl), NICHT dem TaW — genau die Aufteilung, die auch echte Waffen nutzen.
// `stats` statt eines eigenen loadStats()-Aufrufs: computeProbeForCharacter
// hat es schon geladen, und stats.talente trägt bereits Item-Boni (talentMitBoni).
function resolveAbilityWeaponProbes(
  characterId: number,
  stats: CharStats,
  weapon: Extract<ProbeSource, { kind: 'ability' }>['weapon'],
): { at: number; pa: number; bl: number } | null {
  if (!weapon) return null;
  const bv = computeBaseValues(stats.attrs, stats.baseInputs);
  const base = { at: bv.at.ergebnis, pa: bv.pa.ergebnis, bl: bv.bl.ergebnis };
  let talentId: number;
  let weaponMod = { at: 0, pa: 0, bl: 0 };
  if (weapon.kind === 'item') {
    const item = loadItems(characterId).find((it) => it.id === weapon.itemId && it.waffenArt === 'nah');
    if (!item) return null;
    talentId = Number(waffenStatWert(item, 'talentId')) || 0;
    weaponMod = { at: waffenStatZahl(item, 'at'), pa: waffenStatZahl(item, 'pa'), bl: waffenStatZahl(item, 'bl') };
  } else {
    talentId = weapon.talentId;
  }
  const talent = stats.talente.find((t) => t.talentId === talentId);
  return weaponProbes(weaponMod, base, { at: talent?.at ?? 0, pa: talent?.pa ?? 0, bl: talent?.bl ?? 0 });
}

export function computeProbeForCharacter(characterId: number, source: ProbeSource): ComputedProbe | null {
  const stats = loadStats(characterId);
  const attrs = stats.attrs;
  switch (source.kind) {
    case 'attribute': {
      // Eigenschaftsprobe: ein einzelner W20 gegen den Attributswert
      // (Basis + Bonus, wie auf dem Bogen in der Max-Spalte).
      return { n: 1, probeZahl: attrMax(attrs, source.attr), label: ATTR_LABELS[source.attr], attrParts: [source.attr] };
    }
    case 'talent': {
      // Vom KATALOG aus, nicht von char_talents: der Bogen zeigt für jedes
      // Talent eine Probe-Zahl, auch für ungelernte. Ein Wurf darauf ist ein
      // regulärer ungelernter Versuch und muss möglich sein. Der TaW kommt aus
      // stats.talente statt einem eigenen JOIN — das trägt schon Item-Boni
      // (auch auf ein nie angerührtes Talent, siehe loadStats) und fällt für
      // ein wirklich ungelerntes auf 0 zurück, wie vorher COALESCE(ct.taw, 0).
      const row = db.prepare(`SELECT probe, name FROM talents_catalog WHERE id = ?`).get(source.talentId) as
        | { probe: string; name: string }
        | undefined;
      // Kampftalente haben keine Formel — sie werden über den Waffen-Reiter gewürfelt.
      if (!row || !row.probe) return null;
      const parts = row.probe.split('/').map((p) => p.trim().toUpperCase());
      if (parts.length !== 3) return null;
      const taw = stats.talente.find((t) => t.talentId === source.talentId)?.taw ?? 0;
      // + talentProbeBonus: eine direkte Probe-Erschwernis/-Erleichterung
      // (feld 'probe'), unskaliert und getrennt vom TaW-Weg über erleichterung().
      const probeZahl = talentProbeZahl(attrs, parts as [AttrCode, AttrCode, AttrCode], taw) + talentProbeBonus(source.talentId, stats.boni);
      return { n: 3, probeZahl, label: row.name, attrParts: parts as AttrCode[] };
    }
    case 'ability': {
      const row = db
        .prepare('SELECT name, probe FROM char_abilities WHERE character_id = ? AND id = ?')
        .get(characterId, source.abilityId) as { name: string; probe: string } | undefined;
      if (!row) return null;
      const parts = parseProbeExpr(row.probe);
      if (!parts) return null;
      const hasWeaponTerm = parts.some((p) => p === 'AT' || p === 'PA' || p === 'BL');
      // Ohne AT/PA/BL im Ausdruck reicht der attributbasierte Weg — kein
      // Waffen-Bezug nötig, `source.weapon` wird ignoriert, falls doch gesetzt.
      const weapon = hasWeaponTerm ? resolveAbilityWeaponProbes(characterId, stats, source.weapon) : null;
      if (hasWeaponTerm && !weapon) return null;
      const probeZahl = abilityProbeZahl(attrs, row.probe, weapon);
      if (probeZahl === null) return null;
      const attrParts = parts.filter((p): p is AttrCode => p !== 'AT' && p !== 'PA' && p !== 'BL');
      return { n: parts.length, probeZahl, label: row.name, attrParts: attrParts.length ? attrParts : undefined };
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
      const wantsArt = source.probe === 'fk' ? 'fern' : 'nah';
      const item = loadItems(characterId).find((it) => it.id === source.itemId && it.waffenArt === wantsArt);
      if (!item) return null;
      const talentId = Number(waffenStatWert(item, 'talentId')) || 0;
      const talent = stats.talente.find((t) => t.talentId === talentId);
      const bv = computeBaseValues(attrs, stats.baseInputs);
      const label = item.name;
      if (source.probe === 'fk') {
        const probeZahl = weaponProbe(waffenStatZahl(item, 'atMod'), bv.fk.ergebnis, talent?.at ?? 0);
        return { n: 1, probeZahl, label: `${label} (FK)` };
      }
      const weaponMod = waffenStatZahl(item, source.probe);
      const baseErgebnis = bv[source.probe].ergebnis;
      const talentSplit = talent?.[source.probe] ?? 0;
      const probeZahl = weaponProbe(weaponMod, baseErgebnis, talentSplit);
      return { n: 1, probeZahl, label: `${label} (${source.probe.toUpperCase()})` };
    }
    case 'baseValue': {
      const bv = computeBaseValues(attrs, stats.baseInputs);
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
  add({ kind: 'baseValue', key: 'ini' }, 'baseValue');

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

  const items = loadItems(characterId);
  for (const it of items) {
    if (it.waffenArt === 'nah') {
      for (const probe of ['at', 'pa', 'bl'] as const) add({ kind: 'weapon', itemId: it.id, probe }, 'weapon');
    } else if (it.waffenArt === 'fern') {
      add({ kind: 'weapon', itemId: it.id, probe: 'fk' }, 'weapon');
    }
  }

  return out;
}

// Nur die als 📌-Favorit markierten Talente/Zauber-Fähigkeiten (Talente.tsx/
// AbilityManager.tsx, Spalte `favorit`) — fürs Würfel-Favoriten-Flyout
// (ShortcutsFlyout.tsx), deutlich schlanker als listRollableProbes (das den
// ganzen Talent-Katalog + jede Waffe/Sprache durchrechnet).
export function listFavoriteProbes(characterId: number): RollableProbe[] {
  const out: RollableProbe[] = [];
  const add = (source: ProbeSource, kind: RollableProbe['kind']) => {
    const computed = computeProbeForCharacter(characterId, source);
    if (computed) out.push({ source, kind, label: computed.label, n: computed.n, probeZahl: computed.probeZahl });
  };

  const talents = db
    .prepare('SELECT talent_id AS id FROM char_talents WHERE character_id = ? AND favorit = 1')
    .all(characterId) as { id: number }[];
  for (const t of talents) add({ kind: 'talent', talentId: t.id }, 'talent');

  const abilities = db
    .prepare('SELECT id FROM char_abilities WHERE character_id = ? AND favorit = 1 ORDER BY pos, id')
    .all(characterId) as { id: number }[];
  for (const a of abilities) add({ kind: 'ability', abilityId: a.id }, 'ability');

  return out;
}
