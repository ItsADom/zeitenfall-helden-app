// The tile-texture catalogue for the virtual table. A frozen list, not
// logic — swapping artwork later is a rendering change, not a migration. See
// "The texture catalogue" in docs/concepts/virtual-table.md for how this was
// sourced and reviewed.

export interface TileMaterial {
  /** What gets stored in tiles_json as `t:<key>` — never the filename. */
  key: string;
  label: string;
  /** Picker grouping. */
  gruppe: string;
  /** Filename under client/public/tiles/; absent = generated client-side (water). */
  datei?: string;
  /** Autotile layering — higher overdraws lower where two materials meet. */
  prio: number;
  /**
   * How this material meets its neighbours: 'hart' for anything built or laid
   * (straight lines), 'natuerlich' for anything grown or poured (may fray).
   * Belongs to the material, not the board — see "Autotiling without edge
   * art" in the plan.
   */
  kante: 'hart' | 'natuerlich';
}

export const TILE_MATERIALS: TileMaterial[] = [
  { key: 'wasser-tief', label: 'Wasser (tief)', gruppe: 'Wasser', prio: 10, kante: 'natuerlich' },
  { key: 'wasser-seicht', label: 'Wasser (seicht)', gruppe: 'Wasser', prio: 12, kante: 'natuerlich' },
  { key: 'lava', label: 'Lava', gruppe: 'Gefahr', datei: 'lava.jpg', prio: 14, kante: 'natuerlich' },
  { key: 'sand', label: 'Sand', gruppe: 'Boden', datei: 'sand.jpg', prio: 20, kante: 'natuerlich' },
  { key: 'erde', label: 'Erde', gruppe: 'Boden', datei: 'erde.jpg', prio: 25, kante: 'natuerlich' },
  { key: 'gras', label: 'Gras', gruppe: 'Boden', datei: 'gras.jpg', prio: 30, kante: 'natuerlich' },
  { key: 'moos', label: 'Waldboden', gruppe: 'Boden', datei: 'moos.jpg', prio: 35, kante: 'natuerlich' },
  { key: 'schnee', label: 'Schnee', gruppe: 'Boden', datei: 'schnee.jpg', prio: 40, kante: 'natuerlich' },
  { key: 'teppich', label: 'Teppich', gruppe: 'Innenraum', datei: 'teppich.jpg', prio: 45, kante: 'hart' },
  { key: 'holzdielen', label: 'Holzdielen', gruppe: 'Innenraum', datei: 'holzdielen.jpg', prio: 50, kante: 'hart' },
  { key: 'bretter', label: 'Bretter', gruppe: 'Innenraum', datei: 'bretter.jpg', prio: 52, kante: 'hart' },
  { key: 'steinboden', label: 'Steinboden', gruppe: 'Innenraum', datei: 'steinboden.jpg', prio: 60, kante: 'hart' },
  { key: 'fliesen', label: 'Fliesen', gruppe: 'Innenraum', datei: 'fliesen.jpg', prio: 62, kante: 'hart' },
  { key: 'ziegel', label: 'Ziegel', gruppe: 'Wand', datei: 'ziegel.jpg', prio: 65, kante: 'hart' },
  { key: 'fels', label: 'Fels', gruppe: 'Wand', datei: 'fels.jpg', prio: 70, kante: 'natuerlich' },
];

export const TILE_MATERIAL_BY_KEY: Record<string, TileMaterial> = Object.fromEntries(
  TILE_MATERIALS.map((m) => [m.key, m]),
);
