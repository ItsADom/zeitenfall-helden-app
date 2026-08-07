import { createContext, useContext, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { UserInfo } from '@shared/types';
import { apiGet, apiPost, setUnauthorizedHandler } from './api';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import AdminPage from './pages/Admin';
import GroupPage from './pages/Group';
import CharacterPage from './pages/Character';
import ChangelogPage from './pages/Changelog';
import ThemePicker from './components/ThemePicker';
import { useTheme } from './theme';

interface AuthContextValue {
  user: UserInfo;
  refresh: () => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export const useAuth = () => useContext(AuthContext)!;

export default function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  // Farbthema app-weit anwenden (auch auf der Anmeldeseite). Muss vor den
  // frühen returns stehen, damit die Hook-Reihenfolge stabil bleibt.
  const [theme, setTheme] = useTheme();

  const refresh = () => {
    apiGet<UserInfo>('/api/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);
  // Bei abgelaufener Sitzung (401) zurück zur Anmeldung
  useEffect(() => setUnauthorizedHandler(() => setUser(null)), []);

  if (loading) return <main className="muted">Lade…</main>;
  if (!user) return <LoginPage onLogin={(u) => setUser(u)} />;

  const logout = async () => {
    await apiPost('/api/logout');
    setUser(null);
    navigate('/');
  };

  return (
    <AuthContext.Provider value={{ user, refresh }}>
      <header className="topbar">
        <Link to="/">Heldenverwaltung</Link>
        {user.isGm && <Link to="/verwaltung">Verwaltung</Link>}
        <Link to="/changelog">Änderungen</Link>
        <div className="spacer" />
        <ThemePicker theme={theme} onChange={setTheme} />
        <span>
          {user.displayName} {user.isGm ? '(Spielleiter)' : ''}
        </span>
        <button onClick={logout}>Abmelden</button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/verwaltung" element={user.isGm ? <AdminPage /> : <Navigate to="/" />} />
          <Route path="/gruppe/:id" element={<GroupPage />} />
          <Route path="/charakter/:id" element={<CharacterPage />} />
          <Route path="/changelog" element={<ChangelogPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </AuthContext.Provider>
  );
}
