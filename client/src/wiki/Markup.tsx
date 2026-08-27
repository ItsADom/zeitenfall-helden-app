// Renders a parsed wiki page.
//
// The syntax tree goes straight to React elements — there is no HTML string
// anywhere in this file, and there must never be. That is what makes markup
// injection impossible by construction instead of by sanitising, and it is the
// reason `dangerouslySetInnerHTML` does not appear anywhere in this app.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WikiBlock, WikiDoc, WikiInline } from '@shared/wikiMarkup';

/** Targets that do not exist (or are invisible to this reader) render red. */
export type LinkZiele = Record<string, string | null>;

function InlineKnoten({ knoten, ziele }: { knoten: WikiInline; ziele: LinkZiele }) {
  switch (knoten.typ) {
    case 'text':
      return <>{knoten.text}</>;
    case 'umbruch':
      return <br />;
    case 'code':
      return <code className="wiki-code">{knoten.text}</code>;
    case 'fett':
      return (
        <strong>
          <InlineListe kinder={knoten.kinder} ziele={ziele} />
        </strong>
      );
    case 'kursiv':
      return (
        <em>
          <InlineListe kinder={knoten.kinder} ziele={ziele} />
        </em>
      );
    case 'wikilink': {
      const titel = ziele[knoten.slug];
      // Unknown target: a red link that offers to create the page, with the
      // title pre-filled. Classic wiki behaviour, and the cheapest way to grow
      // a wiki — you write the link first and fill it in later.
      if (titel == null) {
        return (
          <Link className="wiki-rotlink" to={`/wiki/neu?titel=${encodeURIComponent(knoten.text)}`} title="Seite anlegen">
            {knoten.text}
          </Link>
        );
      }
      return (
        <Link className="wiki-link" to={`/wiki/${knoten.slug}`} title={titel}>
          {knoten.text}
        </Link>
      );
    }
    case 'extlink':
      // Only http(s) ever reaches here — the parser drops everything else to
      // plain text rather than emitting a link node.
      return (
        <a className="wiki-extlink" href={knoten.url} target="_blank" rel="noopener noreferrer">
          {knoten.text}
        </a>
      );
    default:
      return null;
  }
}

function InlineListe({ kinder, ziele }: { kinder: WikiInline[]; ziele: LinkZiele }) {
  return (
    <>
      {kinder.map((k, i) => (
        <InlineKnoten key={i} knoten={k} ziele={ziele} />
      ))}
    </>
  );
}

// Plain-text content of a cell, for sort comparison only — never rendered
// (rendering still goes through InlineListe, links and formatting intact).
function inlineText(kinder: WikiInline[]): string {
  return kinder
    .map((k) => {
      switch (k.typ) {
        case 'text':
        case 'code':
        case 'wikilink':
        case 'extlink':
          return k.text;
        case 'umbruch':
          return ' ';
        case 'fett':
        case 'kursiv':
          return inlineText(k.kinder);
        default:
          return '';
      }
    })
    .join('');
}

// Click-header-to-sort, following the same state shape/CSS as the character
// sheet's dynamic tables (Sektionen.tsx) — but over plain cell text/numbers
// instead of typed DynColumn/DynRow, since wiki tables are just markup.
function WikiTabelle({ kopf, zeilen, ziele }: { kopf: WikiInline[][]; zeilen: WikiInline[][][]; ziele: LinkZiele }) {
  const [sort, setSort] = useState<{ index: number; dir: 1 | -1 } | null>(null);
  const toggleSort = (i: number) =>
    setSort((prev) => (prev?.index !== i ? { index: i, dir: 1 } : prev.dir === 1 ? { index: i, dir: -1 } : null));

  const order = useMemo(() => {
    const idx = zeilen.map((_, i) => i);
    if (!sort) return idx;
    return idx.slice().sort((a, b) => {
      const va = inlineText(zeilen[a][sort.index] ?? []).trim();
      const vb = inlineText(zeilen[b][sort.index] ?? []).trim();
      const na = Number(va.replace(',', '.'));
      const nb = Number(vb.replace(',', '.'));
      const bothNumeric = va !== '' && vb !== '' && !Number.isNaN(na) && !Number.isNaN(nb);
      const cmp = bothNumeric ? na - nb : va.localeCompare(vb, 'de', { numeric: true, sensitivity: 'base' });
      return cmp * sort.dir;
    });
  }, [zeilen, sort]);

  // Reuses the sheet table styling, and deliberately WITHOUT its own overflow:
  // a box with overflow becomes a scroll container in both axes and steals
  // the page's scrolling (see CLAUDE.md).
  return (
    <div className="table-wrap wiki-tabelle">
      <table className="sheet">
        <thead>
          <tr>
            {kopf.map((z, i) => (
              <th key={i} className="sortable" title="Zum Sortieren klicken" onClick={() => toggleSort(i)}>
                <InlineListe kinder={z} ziele={ziele} />
                <span className="sort-caret">{sort?.index === i ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((i) => (
            <tr key={i}>
              {zeilen[i].map((z, j) => (
                <td key={j}>
                  <InlineListe kinder={z} ziele={ziele} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockKnoten({ block, ziele }: { block: WikiBlock; ziele: LinkZiele }) {
  switch (block.typ) {
    case 'absatz':
      return (
        <p>
          <InlineListe kinder={block.kinder} ziele={ziele} />
        </p>
      );
    case 'ueberschrift': {
      // h1 belongs to the page title, so the document's own levels start at h2.
      const Tag = (['h2', 'h3', 'h4'] as const)[block.ebene - 1];
      return (
        <Tag id={block.anker} className="wiki-ueberschrift">
          <InlineListe kinder={block.kinder} ziele={ziele} />
        </Tag>
      );
    }
    case 'liste': {
      const Tag = block.geordnet ? 'ol' : 'ul';
      return (
        <Tag className="wiki-liste">
          {block.punkte.map((p, i) => (
            <li key={i}>
              <InlineListe kinder={p} ziele={ziele} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'zitat':
      return (
        <blockquote className="wiki-zitat">
          <InlineListe kinder={block.kinder} ziele={ziele} />
        </blockquote>
      );
    case 'trenner':
      return <hr className="wiki-trenner" />;
    case 'code':
      return (
        <pre className="wiki-codeblock">
          <code>{block.text}</code>
        </pre>
      );
    case 'tabelle':
      return <WikiTabelle kopf={block.kopf} zeilen={block.zeilen} ziele={ziele} />;
    case 'bild': {
      // The bytes come from helden-assets.db through the wiki's own route,
      // which repeats the page's visibility check — so a picture a reader may
      // not have simply does not load, rather than being hidden by CSS.
      const quelle = `/api/wiki/bilder/${encodeURIComponent(block.slug)}`;
      const klassen = [
        'wiki-bild',
        block.groesse && `wiki-bild-${block.groesse}`,
        block.position && `wiki-bild-${block.position}`,
      ]
        .filter(Boolean)
        .join(' ');
      const bild = (
        <img src={quelle} alt={block.unterschrift || 'Bild'} loading="lazy" />
      );
      return (
        <figure className={klassen}>
          {/* Verkleinert man ein Bild, kann man es nicht mehr lesen — deshalb
              führt genau dann ein Klick zur vollen Auflösung. Ohne Größenangabe
              ändert sich nichts: eine Seite von vorher bekommt keinen Link,
              den sie nie hatte. */}
          {block.groesse ? (
            <a href={quelle} target="_blank" rel="noopener noreferrer" title="In voller Größe öffnen">
              {bild}
            </a>
          ) : (
            bild
          )}
          {block.unterschrift && <figcaption>{block.unterschrift}</figcaption>}
        </figure>
      );
    }
    case 'gmplatzhalter':
      // Only in the editor, and only for someone who may not read the region:
      // the text stays on the server, the marker keeps its place in the
      // document, and a save puts the original back exactly here.
      return (
        <div className="wiki-gm wiki-gm-verborgen">
          <div className="wiki-gm-marke">Nur Spielleiter</div>
          <p className="muted">
            Dieser Abschnitt ist für dich ausgeblendet. Lass die Zeile stehen, dann bleibt er erhalten.
          </p>
        </div>
      );
    case 'gmblock':
      // Only ever reaches a GM: the server strips these regions from the
      // response for everyone else, so this is a marker, not a permission check.
      return (
        <div className="wiki-gm">
          <div className="wiki-gm-marke">Nur Spielleiter</div>
          <BlockListe bloecke={block.bloecke} ziele={ziele} />
        </div>
      );
    default:
      return null;
  }
}

function BlockListe({ bloecke, ziele }: { bloecke: WikiBlock[]; ziele: LinkZiele }) {
  return (
    <>
      {bloecke.map((b, i) => (
        <BlockKnoten key={i} block={b} ziele={ziele} />
      ))}
    </>
  );
}

export default function WikiMarkup({ doc, ziele }: { doc: WikiDoc; ziele: LinkZiele }) {
  if (doc.bloecke.length === 0) return <p className="muted">Diese Seite ist noch leer.</p>;
  return (
    <div className="wiki-inhalt">
      <BlockListe bloecke={doc.bloecke} ziele={ziele} />
    </div>
  );
}
