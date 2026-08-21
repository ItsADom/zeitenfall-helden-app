import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { parseWiki } from '@shared/wikiMarkup';
import { wikiTagKey } from '@shared/wikiTags';
import { WIKI_LIMITS } from '@shared/wikiTypen';
import type { WikiKategorie, WikiSeiteVoll } from '@shared/wikiTypen';
import { ApiError } from '../api';
import { observeAutosize } from '../components/autosize';
import { usePersistedState } from '../components/persist';
import { useWikiBarHeight } from '../components/stickyChrome';
import { useAuth } from '../App';
import { ConfirmDeleteButton } from '../components/ConfirmDeleteButton';
import { ExitGuard } from '../components/exitGuard';
import WikiBilder from './Bilder';
import WikiDiff from './Diff';
import WikiMarkup from './Markup';
import WikiSpickzettel from './Spickzettel';
import { ladeKategorien, ladeQuelle, speichereSeite } from './api';

/**
 * Toggles one category in the comma-separated field, comparing on the folded
 * key so clicking „NPCs" removes an „npcs" that is already there instead of
 * adding a second spelling of the same category.
 */
function schalteKategorie(feld: string, tag: string): string {
  const vorhanden = feld
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const key = wikiTagKey(tag);
  const ohne = vorhanden.filter((t) => wikiTagKey(t) !== key);
  return (ohne.length === vorhanden.length ? [...vorhanden, tag] : ohne).join(', ');
}

// Editing a page.
//
// Explicit „Speichern", not the sheet's debounced autosave: every save becomes
// one entry in the change log, and forty entries per paragraph would make that
// log useless. The comment field only makes sense at a deliberate save too.
//
// The crash guard is a per-device localStorage draft. It never creates a
// revision — it exists so a closed tab does not cost an evening's writing.

type Ansicht = 'schreiben' | 'vorschau';

export default function WikiEditor() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const barRef = useWikiBarHeight();
  const { user } = useAuth();

  const [seite, setSeite] = useState<WikiSeiteVoll | null>(null);
  const [titel, setTitel] = useState('');
  const [text, setText] = useState('');
  const [kommentar, setKommentar] = useState('');
  const [tags, setTags] = useState('');
  const [basisRev, setBasisRev] = useState<number | null>(null);
  const [ansicht, setAnsicht] = useState<Ansicht>('schreiben');
  const [status, setStatus] = useState('');
  const [fehler, setFehler] = useState('');
  const [konflikt, setKonflikt] = useState<{ text: string; autor: string } | null>(null);
  const [bekannteKategorien, setBekannteKategorien] = useState<WikiKategorie[]>([]);
  const feldRef = useRef<HTMLTextAreaElement | null>(null);

  // Survives a crashed tab; cleared the moment a real save succeeds.
  const [entwurf, setEntwurf] = usePersistedState<string | null>(`wiki:entwurf:${slug}`, null);

  useEffect(() => {
    // ladeQuelle, not ladeSeite: the editor needs the source WITH the [[gm:n]]
    // markers, so saving cannot drop a GM-only section it was never shown.
    ladeQuelle(slug)
      .then((d) => {
        setSeite(d.seite);
        setTitel(d.seite.titel);
        setText(d.seite.text);
        setTags(d.seite.tags.join(', '));
        setBasisRev(d.seite.revisionId || null);
      })
      .catch((e) =>
        setFehler(
          e instanceof ApiError && e.status === 403
            ? 'Diese Seite ist geschützt — nur die Spielleitung darf sie bearbeiten.'
            : 'Seite konnte nicht geladen werden',
        ),
      );
  }, [slug]);

  // What other pages are already filed under. Without this, „NSC" and „NPC"
  // become two categories within a week and nobody notices until neither is
  // complete. Failure is silent on purpose — the field still works typed.
  useEffect(() => {
    ladeKategorien()
      .then((d) => setBekannteKategorien(d.kategorien))
      .catch(() => setBekannteKategorien([]));
  }, []);

  // The textarea grows with its content instead of scrolling inside itself —
  // no box in this app gets its own scroll area.
  useEffect(() => {
    if (feldRef.current) return observeAutosize(feldRef.current);
  }, [seite, ansicht]);

  const schmutzig = !!seite && (titel !== seite.titel || text !== seite.text || tags !== seite.tags.join(', '));

  useEffect(() => {
    if (schmutzig) setEntwurf(text);
  }, [schmutzig, text, setEntwurf]);

  /**
   * `basis` overrides the revision this save claims to build on. Only the
   * conflict view passes it, to re-base onto what is now current — a deliberate
   * overwrite by someone who has seen the difference.
   */
  const speichern = useCallback(
    async (basis: number | null = basisRev) => {
    if (!seite) return;
    setFehler('');
    setKonflikt(null);
    setStatus('Speichere…');
    try {
      const d = await speichereSeite(slug, { titel, text, kommentar, tags, basisRev: basis });
      setSeite(d.seite);
      setBasisRev(d.seite.revisionId || null);
      setKommentar('');
      setEntwurf(null);
      setStatus(`Gespeichert (${new Date().toLocaleTimeString()})`);
      navigate(`/wiki/${d.kanonisch}`);
    } catch (e) {
      setStatus('');
      if (e instanceof ApiError && e.status === 409) {
        // Somebody else saved first. No automatic merge — that is where prose
        // quietly dies. The author gets both texts side by side and decides.
        const body = (e.data ?? {}) as { aktuellerText?: string; aktuellerAutor?: string };
        setKonflikt({ text: String(body.aktuellerText ?? ''), autor: String(body.aktuellerAutor ?? '') });
        setFehler(
          'Die Seite wurde geändert, seit du angefangen hast. Dein Text steht noch im Feld — vergleiche ihn unten mit der aktuellen Fassung.',
        );
      } else if (e instanceof ApiError && e.status === 403) {
        setFehler('Diese Seite ist geschützt — nur die Spielleitung darf sie bearbeiten.');
      } else {
        setFehler(e instanceof Error ? e.message : 'Fehler beim Speichern');
      }
    }
    },
    [seite, slug, titel, text, kommentar, tags, basisRev, navigate, setEntwurf],
  );

  /** Keep my text, accept that it replaces theirs. */
  const trotzdemSpeichern = useCallback(async () => {
    try {
      const d = await ladeQuelle(slug);
      setBasisRev(d.seite.revisionId || null);
      // Passed explicitly: the state above has not landed yet when speichern runs.
      await speichern(d.seite.revisionId || null);
    } catch {
      setFehler('Die aktuelle Fassung konnte nicht geladen werden.');
    }
  }, [slug, speichern]);

  /** Throw my text away and start again from theirs. */
  const neuLaden = useCallback(async () => {
    try {
      const d = await ladeQuelle(slug);
      setSeite(d.seite);
      setTitel(d.seite.titel);
      setText(d.seite.text);
      setTags(d.seite.tags.join(', '));
      setBasisRev(d.seite.revisionId || null);
      setEntwurf(null);
      setKonflikt(null);
      setFehler('');
    } catch {
      setFehler('Die aktuelle Fassung konnte nicht geladen werden.');
    }
  }, [slug, setEntwurf]);

  /**
   * Drops markup in at the caret. Appending at the end would be simpler and
   * wrong: an image belongs where the author was writing, and hunting for it at
   * the bottom of the source afterwards is exactly the friction that stops
   * people using pictures at all.
   */
  const einfuegen = useCallback((markup: string) => {
    const feld = feldRef.current;
    if (!feld) {
      setText((t) => `${t}\n\n${markup}\n`);
      return;
    }
    const von = feld.selectionStart ?? feld.value.length;
    const bis = feld.selectionEnd ?? von;
    // Bildmarken müssen allein auf ihrer Zeile stehen — sonst sind sie Text.
    const davor = feld.value.slice(0, von);
    const danach = feld.value.slice(bis);
    const block = `${davor.endsWith('\n') || !davor ? '' : '\n'}${markup}\n${danach.startsWith('\n') ? '' : '\n'}`;
    setText(davor + block + danach);
    setAnsicht('schreiben');
    requestAnimationFrame(() => {
      feld.focus();
      const ende = (davor + block).length;
      feld.setSelectionRange(ende, ende);
    });
  }, []);

  // Ctrl+S is what everyone's fingers already do in an editor. Escape leaves —
  // but ONLY with nothing unsaved: a key pressed by reflex must never be able
  // to throw away half an hour of writing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void speichern();
      }
      if (e.key === 'Escape' && !schmutzig && seite) navigate(`/wiki/${seite.slug}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [speichern, schmutzig, seite, navigate]);

  if (fehler && !seite) return <p className="error">{fehler}</p>;
  if (!seite) return <p className="muted">Lade…</p>;

  return (
    <div className="wiki wiki-editor">
      <ExitGuard dirty={schmutzig} />
      <div className="wiki-editorleiste screen-only" ref={barRef}>
        <div className="wiki-editorleiste-links">
          <div className="wiki-seg">
            <button className={ansicht === 'schreiben' ? 'active' : ''} onClick={() => setAnsicht('schreiben')}>
              Schreiben
            </button>
            <button className={ansicht === 'vorschau' ? 'active' : ''} onClick={() => setAnsicht('vorschau')}>
              Vorschau
            </button>
          </div>
          {schmutzig && <span className="muted">Ungespeicherte Änderungen</span>}
          <span className="savestate">{status}</span>
        </div>
        <div className="wiki-editorleiste-rechts">
          <Link className="small" to={`/wiki/${seite.slug}`}>
            Abbrechen
          </Link>
          <button className="primary" onClick={() => void speichern()} disabled={!schmutzig}>
            Speichern
          </button>
        </div>
      </div>

      {entwurf != null && entwurf !== text && (
        <p className="wiki-hinweis">
          Es liegt ein ungespeicherter Entwurf von diesem Gerät vor.{' '}
          <button className="small" onClick={() => setText(entwurf)}>
            Entwurf übernehmen
          </button>{' '}
          <button className="small" onClick={() => setEntwurf(null)}>
            Verwerfen
          </button>
        </p>
      )}

      {fehler && <p className="error">{fehler}</p>}
      {konflikt && (
        <div className="panel wiki-konflikt screen-only">
          <h3>Gleichzeitig bearbeitet{konflikt.autor && ` — zuletzt von ${konflikt.autor}`}</h3>
          <p className="muted">
            Nichts wird automatisch zusammengeführt — dabei geht am Ende immer Text verloren, den jemand
            geschrieben hat. Unten steht, was sich unterscheidet: <span className="wiki-diff-minus">−</span> ist die
            gespeicherte Fassung, <span className="wiki-diff-plus">+</span> deine. Arbeite fehlende Stellen von Hand
            ein und speichere erneut.
          </p>
          <div className="wiki-konflikt-aktionen">
            <ConfirmDeleteButton
              className="small"
              title="Deinen Text verwerfen und die gespeicherte Fassung laden"
              onConfirm={() => void neuLaden()}
            >
              Meinen Text verwerfen
            </ConfirmDeleteButton>
            <ConfirmDeleteButton
              className="small"
              title="Deinen Text speichern und die andere Fassung überschreiben"
              onConfirm={() => void trotzdemSpeichern()}
            >
              Trotzdem speichern (überschreibt)
            </ConfirmDeleteButton>
          </div>
          <WikiDiff alt={konflikt.text} neu={text} />
        </div>
      )}

      <div className="field">
        <label>Titel</label>
        <input
          value={titel}
          maxLength={WIKI_LIMITS.TITEL_MAX}
          onChange={(e) => setTitel(e.target.value)}
          placeholder="Titel der Seite"
        />
      </div>

      {ansicht === 'schreiben' ? (
        <textarea
          ref={feldRef}
          className="wiki-quelle"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Text der Seite…"
          spellCheck
        />
      ) : (
        <div className="wiki-vorschau">
          <WikiMarkup doc={parseWiki(text)} ziele={seite.linkZiele} />
        </div>
      )}

      <WikiBilder slug={seite.slug} istGm={user.isGm} onEinfuegen={einfuegen} />

      <WikiSpickzettel istGm={user.isGm} />

      <div className="field">
        <label>Kategorien (mit Komma getrennt)</label>
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ort, NPCs" />
        {bekannteKategorien.length > 0 && (
          <div className="wiki-tags wiki-tagwahl screen-only">
            <span className="muted">Schon vergeben:</span>
            {bekannteKategorien.map((k) => {
              const gesetzt = tags.split(',').some((t) => wikiTagKey(t) === k.key);
              return (
                <button
                  key={k.key}
                  type="button"
                  className={`wiki-tag${gesetzt ? ' active' : ''}`}
                  onClick={() => setTags(schalteKategorie(tags, k.tag))}
                >
                  {k.tag}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="field">
        <label>Was hast du geändert? (erscheint im Änderungsprotokoll)</label>
        <input
          value={kommentar}
          maxLength={WIKI_LIMITS.KOMMENTAR_MAX}
          onChange={(e) => setKommentar(e.target.value)}
          placeholder="Kurze Notiz, optional"
        />
      </div>
    </div>
  );
}
