import express from 'express';
import { attachUser } from './auth.js';
import { api } from './routes.js';
import './db.js';
import './seed.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(attachUser);
app.use('/api', api);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Helden-App Server läuft auf http://localhost:${port}`);
});
