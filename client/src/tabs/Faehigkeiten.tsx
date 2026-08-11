import { AbilityTable } from './AbilityTable';

// Reiter „Fähigkeiten" (Cluster 6): die mundane Sicht auf die Stammliste
// (Techniken, Talente, passive wie aktive). Kein Element, keine Komplexität —
// deshalb nur nach Kategorie gruppierbar.
export default function FaehigkeitenTab() {
  return <AbilityTable magisch={false} persistKey="abil:faehig" groupOptions={['kategorie']} listSortLabel="Nach Fähigkeitenliste" />;
}
