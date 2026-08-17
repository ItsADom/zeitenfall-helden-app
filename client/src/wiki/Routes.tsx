import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import NeueSeiteDialog from './NeueSeiteDialog';
import WikiAenderungen from './Aenderungen';
import WikiEditor from './Editor';
import WikiSeite from './Seite';
import WikiUebersicht from './Uebersicht';
import WikiVerlauf from './Verlauf';

// The wiki's own route table, mounted under /wiki/* so App.tsx gains one route
// instead of ten. Static segments come first — a page titled „Neu" cannot
// shadow /wiki/neu because the slug allocator skips the reserved names.

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

export default function WikiRoutes() {
  return (
    <Routes>
      <Route index element={<WikiUebersicht />} />
      <Route path="neu" element={<NeueSeite />} />
      <Route path="aenderungen" element={<WikiAenderungen />} />
      <Route path=":slug" element={<WikiSeite />} />
      <Route path=":slug/bearbeiten" element={<WikiEditor />} />
      <Route path=":slug/verlauf" element={<WikiVerlauf />} />
      <Route path="*" element={<Navigate to="/wiki" replace />} />
    </Routes>
  );
}
