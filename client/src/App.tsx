import { createContext, useContext, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { UserInfo } from '@shared/types';
import { apiGet, apiPost, setUnauthorizedHandler } from './api';
import LoginPage from './pages/Login';
import CharaktereePage from './pages/Charaktere';
import GruppenPage from './pages/Gruppen';
import ProfilPage from './pages/Profil';
import AdminPage from './pages/Admin';
import GroupPage from './pages/Group';
import CharacterPage from './pages/Character';
import ChangelogPage from './pages/Changelog';
import EinstellungenPage from './pages/Einstellungen';
import AbilityManagerPage from './pages/AbilityManager';
import ThemePicker from './components/ThemePicker';
import ModeToggle from './components/ModeToggle';
import BannerFx from './components/BannerFx';
import { useTopbarHeight } from './components/stickyChrome';
import { isKnownTheme, useAnimations, useMode, useTheme } from './theme';
import type { Mode } from './theme';

interface AuthContextValue {
  user: UserInfo;
  refresh: () => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export const useAuth = () => useContext(AuthContext)!;

// Die persönlichen Anzeige-Einstellungen (Standard-Farbwelt, hell/dunkel,
// Animation) leben in App. Damit die Einstellungen-Seite dieselbe Quelle nutzt
// (statt einer zweiten, nicht synchronen Kopie), werden Werte + Setter über
// einen Kontext gereicht.
export interface ThemeControls {
  theme: string;
  setTheme: (id: string) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  anim: boolean;
  setAnim: (on: boolean) => void;
  // Farbwelt des gerade geöffneten Charakters. Solange gesetzt (und bekannt),
  // überschreibt sie die persönliche Vorgabe — für Farbe UND Animation. Die
  // Charakterseite setzt sie beim Öffnen und räumt sie beim Verlassen wieder ab.
  setOverrideTheme: (id: string | null) => void;
}
const ThemeControlsContext = createContext<ThemeControls | null>(null);
export const useThemeControls = () => useContext(ThemeControlsContext)!;

export default function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  // Farbthema app-weit anwenden (auch auf der Anmeldeseite). Muss vor den
  // frühen returns stehen, damit die Hook-Reihenfolge stabil bleibt.
  const [theme, setTheme] = useTheme();
  const [mode, setMode] = useMode();
  const [anim, setAnim] = useAnimations();
  // Überschreibende Farbwelt eines geöffneten Charakters (null = persönliche
  // Vorgabe). Die angezeigte Farbwelt treibt data-theme UND die Kopf-Animation,
  // damit auf der Charakterseite beides zur Charakter-Farbwelt passt.
  const [overrideTheme, setOverrideTheme] = useState<string | null>(null);
  const displayTheme = overrideTheme && isKnownTheme(overrideTheme) ? overrideTheme : theme;
  useEffect(() => {
    document.documentElement.dataset.theme = displayTheme;
  }, [displayTheme]);
  // Die Kopfleiste klebt oben; was darunter kleben soll, braucht ihre Höhe.
  const topbarRef = useTopbarHeight();

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
      <ThemeControlsContext.Provider value={{ theme, setTheme, mode, setMode, anim, setAnim, setOverrideTheme }}>
      <header className="topbar" ref={topbarRef}>
        <div className="banner-fx" aria-hidden="true">
          {/* animate mit in den Key: ändert der Nutzer den Schalter, baut sich
              der Effekt neu auf (Schleife ⇄ Standbild). */}
          <BannerFx key={`${displayTheme}-${anim}`} theme={displayTheme} animate={anim} />
        </div>
        {/* Platzhaltername — bewusst nicht verlinkt, bis ein prägnanterer Name
            feststeht. „Charaktere" ist der eigentliche Einstieg. */}
        <span className="wordmark">Heldenverwaltung</span>
        <Link to="/charaktere">Charaktere</Link>
        <Link to="/gruppen">Gruppen</Link>
        {/* Spielleiter verwalten Kataloge & Nutzer; Spieler haben stattdessen
            ihre eigene „Einstellungen"-Seite (Tabs, Kategorien, Farbwelt je
            Charakter). Route bleibt intern /verwaltung. */}
        {user.isGm ? (
          <Link to="/verwaltung">Kataloge &amp; Nutzer</Link>
        ) : (
          <Link to="/einstellungen">Einstellungen</Link>
        )}
        <div className="spacer" />
        {/* Die Farbwelt-Auswahl in der Kopfleiste bleibt dem Spielleiter — für
            Spieler ist sie auf die Einstellungen-Seite gewandert. */}
        <Link to="/changelog">Changelog</Link>
        {/* Hell/Dunkel liegt für ALLE direkt in der Kopfleiste; die Farbwelt-
            Auswahl (Farbwelt + Animation) bleibt Spielleiter-Sache. */}
        <ModeToggle />
        {user.isGm && (
          <ThemePicker theme={theme} onChange={setTheme} animate={anim} onAnimateChange={setAnim} />
        )}
        {/* Der Name führt aufs eigene Profil (Passwort ändern). */}
        <Link to="/profil">
          {user.displayName} {user.isGm ? '(Spielleiter)' : ''}
        </Link>
        <button onClick={logout}>Abmelden</button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/charaktere" replace />} />
          <Route path="/charaktere" element={<CharaktereePage />} />
          <Route path="/gruppen" element={<GruppenPage />} />
          <Route path="/profil" element={<ProfilPage />} />
          <Route path="/verwaltung" element={user.isGm ? <AdminPage /> : <Navigate to="/charaktere" />} />
          {/* Einstellungen sind Spieler-Sache; der Spielleiter hat „Kataloge & Nutzer". */}
          <Route path="/einstellungen" element={user.isGm ? <Navigate to="/verwaltung" /> : <EinstellungenPage />} />
          <Route path="/gruppe/:id" element={<GroupPage />} />
          <Route path="/charakter/:id" element={<CharacterPage />} />
          <Route path="/charakter/:id/zauber-faehigkeiten" element={<AbilityManagerPage />} />
          <Route path="/changelog" element={<ChangelogPage />} />
          <Route path="*" element={<Navigate to="/charaktere" />} />
        </Routes>
      </main>
      </ThemeControlsContext.Provider>
    </AuthContext.Provider>
  );
}
