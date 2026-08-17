// Renders a parsed wiki page.
//
// The syntax tree goes straight to React elements — there is no HTML string
// anywhere in this file, and there must never be. That is what makes markup
// injection impossible by construction instead of by sanitising, and it is the
// reason `dangerouslySetInnerHTML` does not appear anywhere in this app.
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
      // Reuses the sheet table styling, and deliberately WITHOUT its own
      // overflow: a box with overflow becomes a scroll container in both axes
      // and steals the page's scrolling (see CLAUDE.md).
      return (
        <div className="table-wrap wiki-tabelle">
          <table className="sheet">
            <thead>
              <tr>
                {block.kopf.map((z, i) => (
                  <th key={i}>
                    <InlineListe kinder={z} ziele={ziele} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.zeilen.map((r, i) => (
                <tr key={i}>
                  {r.map((z, j) => (
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
    case 'bild':
      // Images arrive with the assets database; until then the reference is
      // shown as a placeholder rather than a broken picture.
      return (
        <figure className="wiki-bild">
          <div className="wiki-bild-platzhalter muted">Bild „{block.slug}" — Bilder kommen später.</div>
          {block.unterschrift && <figcaption>{block.unterschrift}</figcaption>}
        </figure>
      );
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
