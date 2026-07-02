import { VISIBILITY_LABELS, VISIBILITY_SECTIONS } from '@shared/types';
import { useChar } from '../pages/Character';

export default function SichtbarkeitTab() {
  const { data, update } = useChar();

  const toggle = (section: string) => {
    update('visibility', { ...data.visibility, [section]: !data.visibility[section] });
  };

  return (
    <div className="panel" style={{ maxWidth: 500 }}>
      <h3>Sichtbarkeit für Gruppenmitglieder</h3>
      <p className="muted">
        Die Personenbeschreibung (Name, Alter, Größe usw.) ist für Gruppenmitglieder immer sichtbar. Zusätzlich freigegebene
        Bereiche:
      </p>
      {VISIBILITY_SECTIONS.map((s) => (
        <div key={s} className="field">
          <label style={{ width: 220 }}>{VISIBILITY_LABELS[s]}</label>
          <input type="checkbox" checked={!!data.visibility[s]} onChange={() => toggle(s)} />
        </div>
      ))}
    </div>
  );
}
