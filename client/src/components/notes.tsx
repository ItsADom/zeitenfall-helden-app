import { useState } from 'react';
import { useDisplayMode, useReadOnly } from './displayMode';
import { TextInput } from './inputs';

// Lange Notizen (an Zaubern/Fähigkeiten und Inventar-Gegenständen) werden in der
// Anzeige nach ~limit Zeichen gekürzt und enden mit einem klickbaren „…", das
// den vollen Text zeigt (und „weniger" klappt wieder ein). Der Zustand ist rein
// lokal — beim Neuladen ist wieder alles eingeklappt. Im DRUCK immer vollständig.

const NOTE_LIMIT = 140; // Zeichen
const LINE_LIMIT = 3; // Zeilen (Umbrüche machen eine Notiz hoch, auch bei wenig Text)

// Ist die Notiz zu lang — nach Zeichen ODER nach Zeilen?
function tooLong(text: string, charLimit: number, lineLimit: number): boolean {
  return text.length > charLimit || text.split('\n').length > lineLimit;
}

// Auf beide Grenzen kürzen: erst auf `lineLimit` Zeilen, dann auf `charLimit`
// Zeichen (möglichst an einer Wortgrenze, kein mitten im Wort abgeschnittener
// Rest). Zeilenumbrüche zählen dabei wie Leerzeichen.
function truncate(text: string, charLimit: number, lineLimit: number): string {
  const lines = text.split('\n');
  let t = lines.length > lineLimit ? lines.slice(0, lineLimit).join('\n') : text;
  if (t.length > charLimit) {
    const cut = t.slice(0, charLimit);
    const sp = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
    t = sp > charLimit * 0.6 ? cut.slice(0, sp) : cut;
  }
  return t.trimEnd();
}

export function CollapsedText({
  text,
  className,
  limit = NOTE_LIMIT,
  lineLimit = LINE_LIMIT,
}: {
  text: string;
  className?: string;
  limit?: number;
  lineLimit?: number;
}) {
  const [open, setOpen] = useState(false);
  const print = useDisplayMode() === 'print';
  if (!text) return null;
  // Im Druck (und bei kurzer Notiz) nichts kürzen.
  if (print || !tooLong(text, limit, lineLimit)) return <div className={className}>{text}</div>;
  return (
    <div className={className}>
      {open ? text : truncate(text, limit, lineLimit)}
      {open ? ' ' : ''}
      <button type="button" className="note-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? 'weniger' : '…'}
      </button>
    </div>
  );
}

// Notiz-Zelle in Tabellen: bleibt im Bearbeiten-Modus ein wachsendes Textfeld,
// zeigt sonst die gekürzte Anzeige. Ersetzt ein blankes <TextInput> in
// Notizspalten (Inventar).
export function NoteField({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const ro = useReadOnly();
  if (!ro) return <TextInput value={value} onChange={onChange} />;
  return <CollapsedText text={value} className={className ?? 'static-value static-text'} />;
}
