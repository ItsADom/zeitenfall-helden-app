import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import NeueSeiteDialog from './NeueSeiteDialog';
import WikiAenderungen from './Aenderungen';
import WikiEditor from './Editor';
import WikiKategorie from './Kategorie';
import WikiKategorien from './Kategorien';
import WikiLayout from './Layout';
import WikiPapierkorb from './Papierkorb';
import WikiSeite from './Seite';
import WikiSuche from './Suche';
import WikiUebersicht from './Uebersicht';
import WikiVerlauf from './Verlauf';

// The wiki's own route table, mounted under /wiki/* so App.tsx gains one route
// instead of ten. Static segments come first — a page titled „Neu" cannot
// shadow /wiki/neu because the slug allocator skips the reserved names.
//
// Everything hangs under WikiLayout, which draws the bar that is on every wiki
// screen. A pathless parent route is what lets that bar survive navigation
// instead of being torn down and rebuilt per page.

/** /wiki/neu — the red-link landing spot, with the title already filled in. */
function NeueSeite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [offen, setOffen] = useState(true);
  return (
    <div className="wiki">
      <NeueSeiteDialog
        open={offen}
        titelVorgabe={params.get('titel') ?? ''}
        onClose={() => {
          setOffen(false);
          navigate('/wiki');
        }}
        onAngelegt={(slug) => navigate(`/wiki/${slug}/bearbeiten`)}
      />
    </div>
  );
}

/**
 * Der Editor wird je Adresse NEU eingehängt.
 *
 * Alles, was er hält, beschreibt genau eine Seite: der Entwurf aus dem
 * localStorage, der ungespeicherte Text, eine Schutzmeldung, ein
 * Konfliktvergleich. Ohne den Schlüssel bleibt der Baustein beim Wechsel der
 * Adresse derselbe und behält sie alle — `usePersistedState` liest seinen
 * Schlüssel nur beim Einhängen, schreibt aber immer unter den aktuellen. Dann
 * bekommt eine frisch angelegte Seite den Entwurf der vorigen angeboten und
 * legt ihn beim ersten Tippen auch noch unter ihrem eigenen Schlüssel ab.
 */
function EditorFuerSeite() {
  const { slug = '' } = useParams();
  return <WikiEditor key={slug} />;
}

export default function WikiRoutes() {
  return (
    <Routes>
      <Route element={<WikiLayout />}>
        <Route index element={<WikiUebersicht />} />
        <Route path="neu" element={<NeueSeite />} />
        <Route path="aenderungen" element={<WikiAenderungen />} />
        <Route path="suche" element={<WikiSuche />} />
        <Route path="kategorien" element={<WikiKategorien />} />
        <Route path="kategorie/:tag" element={<WikiKategorie />} />
        {/* Der Server antwortet Nicht-Spielleitern ohnehin mit 403; die Route
            hier zu führen erspart eine zweite Rollenprüfung im Router. */}
        <Route path="papierkorb" element={<WikiPapierkorb />} />
        <Route path=":slug" element={<WikiSeite />} />
        <Route path=":slug/bearbeiten" element={<EditorFuerSeite />} />
        <Route path=":slug/verlauf" element={<WikiVerlauf />} />
        <Route path="*" element={<Navigate to="/wiki" replace />} />
      </Route>
    </Routes>
  );
}
