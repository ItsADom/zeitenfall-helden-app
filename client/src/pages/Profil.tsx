import { useState } from 'react';
import { apiPut } from '../api';
import { useAuth } from '../App';

// Eigenes Profil. Bislang hing das Passwortändern unten an der Übersichtsseite;
// mit der aufgeteilten Navigation bekommt es eine eigene kleine Seite, erreichbar
// über den Namen oben rechts.
export default function ProfilPage() {
  const { user } = useAuth();
  const [pw, setPw] = useState('');
  const [pwInfo, setPwInfo] = useState('');

  const changePassword = async () => {
    setPwInfo('');
    try {
      await apiPut('/api/me/password', { password: pw });
      setPw('');
      setPwInfo('Passwort geändert.');
    } catch (err) {
      setPwInfo(err instanceof Error ? err.message : 'Fehler');
    }
  };

  return (
    <>
      <h1>Profil</h1>
      <p className="muted">
        {user.displayName}
        {user.isGm ? ' · Spielleiter' : ''}
      </p>

      <div className="panel" style={{ maxWidth: 420, marginTop: 16 }}>
        <h3>Passwort ändern</h3>
        <div className="field">
          <label>Neues Passwort</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="primary" onClick={changePassword} disabled={pw.length < 6}>
            Ändern
          </button>
        </div>
        {pwInfo && <p className="muted">{pwInfo}</p>}
      </div>
    </>
  );
}
