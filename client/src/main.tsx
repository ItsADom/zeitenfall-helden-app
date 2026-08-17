import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';
// Eigene Datei statt weiterer Zeilen in styles.css (4336) — alle Regeln sind
// mit .wiki- benannt und nutzen ausschließlich die vorhandenen Farb-Token.
import './wiki.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
