import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';
// Eigene Datei statt weiterer Zeilen in styles.css (4336) — alle Regeln sind
// mit .wiki- benannt und nutzen ausschließlich die vorhandenen Farb-Token.
import './wiki.css';
// Same reasoning as wiki.css: a self-contained feature gets its own file
// rather than more lines in styles.css. Every rule is named .dice-kino-.
import './kino.css';

// Ein Data Router (statt <BrowserRouter>) — App bringt ihre eigene, tief
// verschachtelte <Routes>/<Route>-Struktur mit, die als Nachfahre eines Data
// Routers weiterhin unverändert funktioniert. Der einzige Grund für den
// Wechsel: `useBlocker` (Exit-Guard bei ungespeicherten Änderungen, siehe
// components/exitGuard.tsx) braucht zwingend einen Data Router — mit
// <BrowserRouter> wirft er einen Invariant-Error.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
