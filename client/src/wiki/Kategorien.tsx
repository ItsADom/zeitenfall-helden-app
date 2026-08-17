import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WikiKategorie } from '@shared/wikiTypen';
import { ladeKategorien } from './api';

// The category directory: which categories exist, and how they sit inside each
// other.
//
// The tree is not a designed structure — it falls out of category pages
// carrying categories themselves. „Kategorie:Städte" tagged „Orte" makes Städte
// a subcategory of Orte, and that is the whole mechanism. Nothing stops someone
// putting Orte inside Städte as well, so the walk below is written to survive
// cycles rather than to trust that none exist.

interface Knoten {
  kat: WikiKategorie;
  kinder: Knoten[];
}

/** Deep enough for any sane structure, shallow enough to stay readable. */
const MAX_TIEFE = 6;

function baueBaum(alle: WikiKategorie[]): Knoten[] {
  const nachKey = new Map(alle.map((k) => [k.key, k]));

  const kinderVon = new Map<string, WikiKategorie[]>();
  for (const k of alle) {
    for (const eltern of k.eltern) {
      if (!nachKey.has(eltern)) continue;
      const liste = kinderVon.get(eltern);
      if (liste) liste.push(k);
      else kinderVon.set(eltern, [k]);
    }
  }

  const platziert = new Set<string>();
  const bauen = (kat: WikiKategorie, pfad: ReadonlySet<string>, tiefe: number): Knoten => {
    platziert.add(kat.key);
    // `pfad` is what makes a cycle harmless: a category already on the way down
    // is not descended into again.
    const kinder =
      tiefe >= MAX_TIEFE
        ? []
        : (kinderVon.get(kat.key) ?? [])
            .filter((kind) => !pfad.has(kind.key))
            .map((kind) => bauen(kind, new Set([...pfad, kind.key]), tiefe + 1));
    return { kat, kinder };
  };

  const wurzeln = alle.filter((k) => k.eltern.every((e) => !nachKey.has(e)));
  const baum = wurzeln.map((k) => bauen(k, new Set([k.key]), 0));

  // Categories that exist only inside a cycle have no root to hang from and
  // would otherwise disappear from the directory entirely.
  for (const k of alle) {
    if (!platziert.has(k.key)) baum.push(bauen(k, new Set([k.key]), 0));
  }
  return baum;
}

function Zweig({ knoten }: { knoten: Knoten }) {
  const { kat, kinder } = knoten;
  return (
    <li>
      <Link className="wiki-kat-name" to={`/wiki/kategorie/${encodeURIComponent(kat.key)}`}>
        {kat.tag}
      </Link>
      <span className="muted wiki-kat-zahl">
        {kat.anzahl} {kat.anzahl === 1 ? 'Seite' : 'Seiten'}
        {kat.unterAnzahl > 0 && ` · ${kat.unterAnzahl} untergeordnet`}
      </span>
      {/* Ohne Beschreibungsseite ist die Kategorie zwar benutzbar, aber
          niemand weiß, wofür sie gedacht ist. */}
      {!kat.seitenSlug && <span className="muted wiki-kat-ohne">ohne Beschreibung</span>}
      {kinder.length > 0 && (
        <ul className="wiki-kat-liste">
          {kinder.map((k) => (
            <Zweig key={k.kat.key} knoten={k} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function WikiKategorien() {
  const [kategorien, setKategorien] = useState<WikiKategorie[] | null>(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    ladeKategorien()
      .then((d) => setKategorien(d.kategorien))
      .catch(() => setFehler('Die Kategorien konnten nicht geladen werden.'));
  }, []);

  const baum = useMemo(() => baueBaum(kategorien ?? []), [kategorien]);

  if (fehler) return <p className="error">{fehler}</p>;

  return (
    <div className="wiki">
      <div className="wiki-kopf">
        <div>
          <h1>Kategorien</h1>
          <p className="muted">
            Eine Kategorie entsteht, sobald eine Seite sie im Feld „Kategorien" trägt. Eine Seite „Kategorie:Orte"
            beschreibt sie — und trägt selbst Kategorien, wodurch sie sich einordnet.
          </p>
        </div>
      </div>

      {kategorien == null ? (
        <p className="muted">Lade…</p>
      ) : kategorien.length === 0 ? (
        <p className="muted">Noch keine Kategorien. Trage bei einer Seite eine ein.</p>
      ) : (
        <ul className="wiki-kat-liste wiki-kat-wurzel">
          {baum.map((k) => (
            <Zweig key={k.kat.key} knoten={k} />
          ))}
        </ul>
      )}
    </div>
  );
}
