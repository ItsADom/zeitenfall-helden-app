// Wiki endpoints.
//
// A thin Express layer on purpose: parse parameters, ask the modules, map the
// two wiki-specific errors onto status codes. Everything that decides anything
// lives in zugriff.ts (who may see what) or seiten.ts (what a save does).
//
// Mounted from routes.ts with one line. The alternative — appending to a file
// that is already 1461 lines — is how that file got to 1461 lines.
import { Router } from 'express';
import { WIKI_LIMITS } from 'shared';
import { requireAuth, requireGm } from '../auth.js';
import { WikiGeschuetzt, WikiKonflikt } from './seiten.js';
import { ladeSeite, legeSeiteAn, listeSeiten, speichereSeite, verweiseAuf } from './seiten.js';
import { anzahlNeu, merkeGesehen, neueSeiten } from './neuigkeiten.js';
import { kategorien, neuIndizieren, seitenInKategorie, sucheSeiten } from './suche.js';
import { autoren, fassungsText, letzteAenderungen, stelleFassungHer, verlaufFuer } from './verlauf.js';
import { darfBearbeiten, seiteFuer } from './zugriff.js';

export const wikiApi = Router();

const leser = (req: { user?: { id: number; isGm: boolean; displayName: string } }) => ({
  id: req.user!.id,
  isGm: req.user!.isGm,
  name: req.user!.displayName,
});

wikiApi.get('/seiten', requireAuth, (req, res) => {
  const user = leser(req);
  const neu = neueSeiten(user);
  res.json({ seiten: listeSeiten(user).map((s) => ({ ...s, neu: neu.has(s.slug) })) });
});

/** Drives the count next to „Wiki" in the top bar. */
wikiApi.get('/neuigkeiten', requireAuth, (req, res) => {
  res.json({ anzahl: anzahlNeu(leser(req)) });
});

/** „Ich habe es gesehen" — sent when the change log is opened. */
wikiApi.post('/gelesen', requireAuth, (req, res) => {
  res.json({ gesehenRev: merkeGesehen(req.user!.id) });
});

wikiApi.post('/seiten', requireAuth, (req, res) => {
  const titel = String((req.body ?? {}).titel ?? '').trim();
  if (!titel) {
    res.status(400).json({ error: 'Titel fehlt' });
    return;
  }
  if (titel.length > WIKI_LIMITS.TITEL_MAX) {
    res.status(400).json({ error: 'Titel ist zu lang' });
    return;
  }
  const seite = legeSeiteAn({ id: req.user!.id, name: req.user!.displayName }, titel);
  res.json({ slug: seite.slug });
});

wikiApi.get('/seiten/:slug', requireAuth, (req, res) => {
  const user = leser(req);
  const seite = seiteFuer(user, String(req.params.slug));
  if (!seite) {
    res.status(404).json({ error: 'Seite nicht gefunden' });
    return;
  }
  // A hit through the alias table answers under the canonical slug so the
  // client can replace the URL instead of keeping a stale one.
  res.json({ seite: ladeSeite(user, seite), kanonisch: seite.slug });
});

// The editor's own payload. Separate from the read route because the two want
// different text: reading drops GM-only regions, editing keeps a [[gm:n]]
// marker where each stood so a save cannot delete what it never showed.
wikiApi.get('/seiten/:slug/quelle', requireAuth, (req, res) => {
  const user = leser(req);
  const seite = seiteFuer(user, String(req.params.slug));
  if (!seite) {
    res.status(404).json({ error: 'Seite nicht gefunden' });
    return;
  }
  if (!darfBearbeiten(user, seite)) {
    res.status(403).json({ error: 'Diese Seite ist geschützt' });
    return;
  }
  res.json({ seite: ladeSeite(user, seite, 'bearbeiten'), kanonisch: seite.slug });
});

wikiApi.put('/seiten/:slug', requireAuth, (req, res) => {
  const user = leser(req);
  const seite = seiteFuer(user, String(req.params.slug));
  if (!seite) {
    res.status(404).json({ error: 'Seite nicht gefunden' });
    return;
  }
  // Protected pages are the one place that admits what it is: the page is
  // visible, so a 403 leaks nothing that a 404 would have hidden.
  if (!darfBearbeiten(user, seite)) {
    res.status(403).json({ error: 'Diese Seite ist geschützt' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const gespeichert = speichereSeite(user, seite, {
      titel: String(body.titel ?? seite.titel),
      text: String(body.text ?? ''),
      kommentar: String(body.kommentar ?? ''),
      tags: body.tags,
      basisRev: body.basisRev == null ? null : Number(body.basisRev),
    });
    // The editor is the caller, so it gets the editor's view of the text back.
    res.json({ seite: ladeSeite(user, gespeichert, 'bearbeiten'), kanonisch: gespeichert.slug });
  } catch (err) {
    if (err instanceof WikiKonflikt) {
      res.status(409).json({
        error: 'konflikt',
        aktuellerText: err.aktuellerText,
        aktuellerAutor: err.aktuellerAutor,
      });
      return;
    }
    if (err instanceof WikiGeschuetzt) {
      res.status(403).json({ error: 'Diese Seite ist geschützt' });
      return;
    }
    throw err;
  }
});

wikiApi.get('/seiten/:slug/verweise', requireAuth, (req, res) => {
  const user = leser(req);
  const seite = seiteFuer(user, String(req.params.slug));
  if (!seite) {
    res.status(404).json({ error: 'Seite nicht gefunden' });
    return;
  }
  res.json({ verweise: verweiseAuf(user, seite) });
});

wikiApi.get('/seiten/:slug/verlauf', requireAuth, (req, res) => {
  const user = leser(req);
  const seite = seiteFuer(user, String(req.params.slug));
  if (!seite) {
    res.status(404).json({ error: 'Seite nicht gefunden' });
    return;
  }
  res.json({
    titel: seite.titel,
    darfBearbeiten: darfBearbeiten(user, seite),
    eintraege: verlaufFuer(user, seite.id),
  });
});

wikiApi.get('/seiten/:slug/fassung/:rev', requireAuth, (req, res) => {
  const user = leser(req);
  const seite = seiteFuer(user, String(req.params.slug));
  if (!seite) {
    res.status(404).json({ error: 'Seite nicht gefunden' });
    return;
  }
  const text = fassungsText(user, seite.id, Number(req.params.rev));
  if (text == null) {
    res.status(404).json({ error: 'Fassung nicht gefunden' });
    return;
  }
  res.json({ text });
});

// „Diese Fassung übernehmen". Writes a NEW revision rather than rewinding, so
// the undo shows up in the log like any other change.
wikiApi.post('/seiten/:slug/wiederherstellen', requireAuth, (req, res) => {
  const user = leser(req);
  const seite = seiteFuer(user, String(req.params.slug));
  if (!seite) {
    res.status(404).json({ error: 'Seite nicht gefunden' });
    return;
  }
  if (!darfBearbeiten(user, seite)) {
    res.status(403).json({ error: 'Diese Seite ist geschützt' });
    return;
  }
  const rev = Number((req.body ?? {}).revisionId);
  const ergebnis = stelleFassungHer(user, seite, rev);
  if (!ergebnis) {
    res.status(404).json({ error: 'Fassung nicht gefunden oder bereits die aktuelle' });
    return;
  }
  res.json({ nr: ergebnis.nr, slug: seite.slug });
});

wikiApi.get('/aenderungen', requireAuth, (req, res) => {
  const q = req.query;
  const text = (name: string): string | undefined => {
    const wert = q[name];
    const s = wert == null ? '' : String(wert).trim();
    return s || undefined;
  };
  res.json({
    eintraege: letzteAenderungen(leser(req), {
      autor: text('autor'),
      slug: text('seite'),
      von: text('von'),
      bis: text('bis'),
      vor: text('vor'),
      limit: Number(q.limit ?? 50),
    }),
  });
});

/** Feeds the change-log filters: who has written, and which pages exist. */
wikiApi.get('/aenderungen/filter', requireAuth, (req, res) => {
  const user = leser(req);
  res.json({
    autoren: autoren(user),
    seiten: listeSeiten(user).map((s) => ({ slug: s.slug, titel: s.titel })),
  });
});

wikiApi.get('/suche', requireAuth, (req, res) => {
  const q = String(req.query.q ?? '');
  res.json({ q, treffer: sucheSeiten(leser(req), q) });
});

wikiApi.get('/kategorien', requireAuth, (req, res) => {
  res.json({ kategorien: kategorien(leser(req)) });
});

wikiApi.get('/kategorie/:tag', requireAuth, (req, res) => {
  res.json({ seiten: seitenInKategorie(leser(req), String(req.params.tag)) });
});

/** Manual repair for the GM. indexNachziehen() covers the automatic cases. */
wikiApi.post('/neu-indizieren', requireAuth, requireGm, (_req, res) => {
  res.json({ seiten: neuIndizieren() });
});

// Placeholder so the GM-only surface has a home from the start; the trash UI
// arrives with the protection phase.
wikiApi.get('/papierkorb', requireAuth, requireGm, (_req, res) => {
  res.json({ seiten: [] });
});
