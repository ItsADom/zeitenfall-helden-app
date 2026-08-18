// Canonical, server-side recompute of a Probe's target number (probeZahl)
// and die count (n) from a character's stored attributes/TaW/weapon data.
// The client only ever sends WHICH Probe to roll (a ProbeSource) — never a
// number — so a tampered client can't roll against an inflated threshold.
import type { AttrCode, ProbeSource } from 'shared';
import { computeBaseValueBases, erleichterung, parseProbeExpr, probeExprZahl, schreibenProbe, sprechenProbe, talentProbeZahl, weaponProbe } from 'shared';
import { db } from './db.js';
import { loadAttributes, loadBaseValueInputs } from './characterData.js';

export interface ComputedProbe {
  n: number;
  probeZahl: number;
  label: string;
}

export function computeProbeForCharacter(characterId: number, source: ProbeSource): ComputedProbe | null {
  const attrs = loadAttributes(characterId);
  switch (source.kind) {
    case 'talent': {
      const row = db
        .prepare(
          `SELECT ct.taw, tc.probe, tc.name FROM char_talents ct
           JOIN talents_catalog tc ON tc.id = ct.talent_id
           WHERE ct.character_id = ? AND ct.talent_id = ?`,
        )
        .get(characterId, source.talentId) as { taw: number; probe: string; name: string } | undefined;
      if (!row || !row.probe) return null;
      const parts = row.probe.split('/').map((p) => p.trim().toUpperCase());
      if (parts.length !== 3) return null;
      const probeZahl = talentProbeZahl(attrs, parts as [AttrCode, AttrCode, AttrCode], row.taw);
      return { n: 3, probeZahl, label: row.name };
    }
    case 'ability': {
      const row = db
        .prepare('SELECT name, probe FROM char_abilities WHERE character_id = ? AND id = ?')
        .get(characterId, source.abilityId) as { name: string; probe: string } | undefined;
      if (!row) return null;
      const parts = parseProbeExpr(row.probe);
      const probeZahl = probeExprZahl(attrs, row.probe);
      if (!parts || probeZahl === null) return null;
      return { n: parts.length, probeZahl, label: row.name };
    }
    case 'sprache': {
      const row = db
        .prepare(
          `SELECT cl.taw, lc.name FROM char_languages cl
           JOIN languages_catalog lc ON lc.id = cl.language_id
           WHERE cl.character_id = ? AND cl.language_id = ?`,
        )
        .get(characterId, source.languageId) as { taw: number; name: string } | undefined;
      if (!row) return null;
      const base = source.mode === 'sprechen' ? sprechenProbe(attrs) : schreibenProbe(attrs);
      const probeZahl = base + erleichterung(row.taw);
      const modeLabel = source.mode === 'sprechen' ? 'Sprechen' : 'Schreiben';
      return { n: 3, probeZahl, label: `${row.name} (${modeLabel})` };
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
      const bv = computeBaseValueBases(attrs, loadBaseValueInputs(characterId));
      const label = String(row.typ ?? '');
      if (source.probe === 'fk') {
        const probeZahl = weaponProbe(Number(row.atMod) || 0, bv.fk, talent?.at ?? 0);
        return { n: 1, probeZahl, label: `${label} (FK)` };
      }
      const weaponMod = Number(row[source.probe]) || 0;
      const baseErgebnis = bv[source.probe];
      const talentSplit = talent?.[source.probe] ?? 0;
      const probeZahl = weaponProbe(weaponMod, baseErgebnis, talentSplit);
      return { n: 1, probeZahl, label: `${label} (${source.probe.toUpperCase()})` };
    }
    default:
      return null;
  }
}
