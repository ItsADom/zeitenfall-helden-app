import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachUser, cleanupSessions } from './auth.js';
import { api } from './routes.js';
import { startBackupSchedule } from './backup.js';
import './db.js';
import './seed.js';

// Abgelaufene Sitzungen beim Start und danach täglich aufräumen
cleanupSessions();
setInterval(cleanupSessions, 24 * 60 * 60 * 1000).unref();

// Tägliche Sicherung der Datenbank
startBackupSchedule();

const app = express();

// Hinter genau einem Reverse-Proxy (nginx): die echte Client-IP aus
// X-Forwarded-For übernehmen, damit die Login-Bremse pro IP greift und nicht
// alle hinter der Proxy-Adresse zusammenfasst.
app.set('trust proxy', 1);
// Kein „X-Powered-By: Express" — verrät nur die Technik, nützt niemandem.
app.disable('x-powered-by');

// HSTS nur, wenn wir hinter HTTPS laufen (gleiches Signal wie das Secure-Cookie):
// weist den Browser an, die Domain künftig ausschließlich über https anzusteuern.
const SECURE = /^(1|true)$/i.test(process.env.SECURE_COOKIES ?? '');
if (SECURE) {
  app.use((_req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  });
}

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
