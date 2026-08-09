import { useState } from 'react';
import { apiPut } from '../api';
import { useAuth } from '../App';

// Eigenes Profil. Bislang hing das Passwortändern unten an der Übersichtsseite;
// mit der aufgeteilten Navigation bekommt es eine eigene kleine Seite, erreichbar
// über den Namen oben rechts. Hier lässt sich auch der Anzeigename ändern.
export default function ProfilPage() {
  const { user, refresh } = useAuth();

  const [name, setName] = useState(user.displayName);
  const [nameInfo, setNameInfo] = useState('');

  const [pw, setPw] = useState('');
  const [pwInfo, setPwInfo] = useState('');

  const nameChanged = name.trim() !== '' && name.trim() !== user.displayName;

  const changeName = async () => {
    setNameInfo('');
    try {
      await apiPut('/api/me/displayName', { displayName: name.trim() });
      // Der Name steht auch oben in der Kopfleiste — nach dem Ändern neu laden.
      refresh();
      setNameInfo('Anzeigename geändert.');
    } catch (err) {
      setNameInfo(err instanceof Error ? err.message : 'Fehler');
    }
  };

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
        Angemeldet als {user.displayName}
        {user.isGm ? ' · Spielleiter' : ''}
      </p>

      <div className="panel" style={{ maxWidth: 420, marginTop: 16 }}>
        <h3>Anzeigename</h3>
        <div className="field">
          <label>Anzeigename</label>
          <input
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nameChanged) void changeName();
            }}
          />
          <button className="primary" onClick={changeName} disabled={!nameChanged}>
            Speichern
          </button>
        </div>
        {nameInfo && <p className="muted">{nameInfo}</p>}
      </div>

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
