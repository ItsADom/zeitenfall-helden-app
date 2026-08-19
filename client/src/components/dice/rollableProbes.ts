import type { ProbeSource } from '@shared/diceProtocol';

// Ein Eintrag aus GET /api/characters/:id/probes — jede Probe, die dieser
// Charakter würfeln kann. Geteilt zwischen der GM-Anfrage (RequestProbePicker)
// und den Proben-Vorschlägen im Würfel-Chat (DicePanel).
export interface RollableProbe {
  source: ProbeSource;
  label: string;
  n: number;
  probeZahl: number;
  kind: 'attribute' | 'talent' | 'ability' | 'sprache' | 'weapon';
}

export const PROBE_KIND_LABEL: Record<RollableProbe['kind'], string> = {
  attribute: 'Eigenschaft',
  talent: 'Talent',
  ability: 'Zauber/Fähigkeit',
  sprache: 'Sprache',
  weapon: 'Waffe',
};
