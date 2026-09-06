// Equipment presets (docs/concepts/equipment-presets.md): a named snapshot of
// which items a character had worn (uid + zone + beidseitig). Applying one is
// a full outfit swap — everything the preset lists ends up worn exactly as
// recorded, everything else currently worn gets benched — computed here as a
// pure function so both the client (Ausruestung.tsx) and any future caller
// share one implementation.
import type { Item } from './items.js';

export interface EquipmentPresetItem {
  itemUid: string;
  // Snapshot cache taken when the preset was saved — used ONLY for the
  // missing-item hint (missingPresetItems below), never read mechanically.
  // An item that later gets renamed keeps showing its OLD name in that hint,
  // which is fine: the hint is about "what did this preset expect", not
  // "what is this item called now".
  itemName: string;
  zone: string;
  beidseitig: boolean;
}

export interface EquipmentPreset {
  id: number;
  name: string;
  items: EquipmentPresetItem[];
}

// Neuer, leerer Preset-Rohling fürs Anlegen-Formular.
export function makeEquipmentPreset(name: string): EquipmentPreset {
  return { id: 0, name, items: [] };
}

// Schnappschuss des aktuell getragenen Zustands — die Grundlage für „Set
// speichern" wie „Neu speichern" (resave): beide rufen das hier auf, resave
// ersetzt nur `items` eines bestehenden Presets statt eins mit neuer id
// anzulegen.
export function equipmentPresetItemsFromWorn(items: readonly Item[]): EquipmentPresetItem[] {
  return items
    .filter((it) => it.location === 'getragen')
    .map((it) => ({ itemUid: it.uid, itemName: it.name, zone: it.zone, beidseitig: it.beidseitig }));
}

// Preset-Einträge, deren uid im aktuellen Bestand nicht (mehr) existiert — der
// Gegenstand wurde gelöscht oder per Cross-Owner-Move weggegeben (shared-
// inventories.md). Fürs Hinweisfenster vor dem Anwenden; der Eintrag selbst
// bleibt im gespeicherten Preset unangetastet (siehe applyEquipmentPreset).
export function missingPresetItems(items: readonly Item[], preset: EquipmentPreset): EquipmentPresetItem[] {
  const uids = new Set(items.map((it) => it.uid));
  return preset.items.filter((pi) => !uids.has(pi.itemUid));
}

// Volles Umziehen: alles, was der Bestand aktuell trägt, aber NICHT im Preset
// steht, wandert auf die Bank; alles, was das Preset listet UND im Bestand
// existiert, wird an der gespeicherten Zone getragen (auch wenn es gerade
// woanders lag — containerUid wird dabei explizit geleert, siehe unten). Ein
// Preset-Eintrag ohne passende uid im Bestand wird übersprungen (siehe
// missingPresetItems) — nicht aus dem Preset entfernt, nur hier ignoriert.
export function applyEquipmentPreset(items: readonly Item[], preset: EquipmentPreset): Item[] {
  const byUid = new Map(preset.items.map((pi) => [pi.itemUid, pi] as const));
  return items.map((it) => {
    const pi = byUid.get(it.uid);
    if (pi) {
      // containerUid explizit geleert: lag das Item seit dem Speichern des
      // Presets in einem Behälter, holt das Anwenden es wieder heraus.
      return { ...it, location: 'getragen', zone: pi.zone, beidseitig: pi.beidseitig, containerUid: '' };
    }
    if (it.location === 'getragen') {
      return { ...it, location: 'bench', zone: '', beidseitig: false };
    }
    return it;
  });
}
