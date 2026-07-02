import { useState } from 'react';
import type { UserInfo } from '@shared/types';
import { apiPost } from '../api';

export default function LoginPage({ onLogin }: { onLogin: (user: UserInfo) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const user = await apiPost<UserInfo>('/api/login', { username, password });
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    }
  };

  return (
    <main>
      <div className="panel login-box">
        <h2>Heldenverwaltung</h2>
        <form onSubmit={submit}>
          <div className="field">
            <label>Benutzername</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Passwort</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit" style={{ marginTop: 8 }}>
            Anmelden
          </button>
        </form>
      </div>
    </main>
  );
}
