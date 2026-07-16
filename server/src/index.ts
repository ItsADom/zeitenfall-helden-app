import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachUser, cleanupSessions } from './auth.js';
import { api } from './routes.js';
import './db.js';
import './seed.js';

// Abgelaufene Sitzungen beim Start und danach täglich aufräumen
cleanupSessions();
setInterval(cleanupSessions, 24 * 60 * 60 * 1000).unref();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(attachUser);
app.use('/api', api);

// Produktionsmodus: gebauten Client ausliefern (client/dist), SPA-Fallback auf index.html
const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    } else {
      next();
    }
  });
  console.log('Liefere gebauten Client aus client/dist aus');
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Helden-App Server läuft auf http://localhost:${port}`);
});
