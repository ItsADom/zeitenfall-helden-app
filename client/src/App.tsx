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
import GroupOverviewPage from './pages/GroupOverview';
import CharacterPage from './pages/Character';
import ChangelogPage from './pages/Changelog';
import HomePage from './pages/Home';
import EinstellungenPage from './pages/Einstellungen';
import AbilityManagerPage from './pages/AbilityManager';
import ModeToggle from './components/ModeToggle';
import NavMenu from './components/NavMenu';
import ProfileMenu from './components/ProfileMenu';
import WikiNavLink from './wiki/NavLink';
import WikiRoutes from './wiki/Routes';
import { WikiNewsProvider } from './wiki/news';
import { OverviewProvider } from './components/overview';
import { RequestsProvider, PendingBadge } from './components/requests';
import { DicePanelProvider, useDicePanel } from './components/dice/DicePanelProvider';
import DicePanel from './components/dice/DicePanel';
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

// Immer sichtbar (der Chatraum ist jetzt eine eigene Auswahl, nicht von der
// gerade betrachteten Seite abhängig) — außer eine Seite blendet ihn bewusst
// aus (DicePanelProvider.setHidden), z. B. eine künftige eigene Chat-Seite.
function DicePanelDock() {
  const { hidden } = useDicePanel();
  if (hidden) return null;
  return <DicePanel />;
}

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
      <OverviewProvider>
      <RequestsProvider enabled={user.isGm || user.isAdmin}>
      {/* Für alle: das Wiki gehört jedem, und das Abzeichen zählt, was seit dem
          letzten Blick in die Änderungen dazugekommen ist. */}
      <WikiNewsProvider>
      <DicePanelProvider>
      <header className="topbar" ref={topbarRef}>
        <div className="banner-fx" aria-hidden="true">
          {/* animate mit in den Key: ändert der Nutzer den Schalter, baut sich
              der Effekt neu auf (Schleife ⇄ Standbild). */}
          <BannerFx key={`${displayTheme}-${anim}`} theme={displayTheme} animate={anim} />
        </div>
        {/* Wortmarke → Startseite. „Zeitenkompass": der Kompass, der die aus
            ihrer Zeit gefallenen Helden von Zeitenfall orientiert. */}
        <Link to="/" className="wordmark">Zeitenkompass</Link>
        <NavMenu kind="charaktere" />
        <NavMenu kind="gruppen" />
        {/* Inhalt zuerst, Verwaltung danach — das Wiki gehört zu den Inhalten. */}
        <WikiNavLink />
        {/* Spielleiter verwalten zusätzlich Kataloge & Nutzer. „Einstellungen"
            liegt für alle Rollen im Profil-Flyout (unten) — und ist vom
            Charakterbogen aus direkt erreichbar. Route bleibt intern /verwaltung. */}
        {(user.isGm || user.isAdmin) && (
          <Link to="/verwaltung" className="nav-badge-host">
            Kataloge &amp; Nutzer
            <PendingBadge />
          </Link>
        )}
        <div className="spacer" />
        <Link to="/changelog">Changelog</Link>
        {/* Hell/Dunkel liegt für ALLE direkt in der Kopfleiste; die Farbwelt-
            Auswahl (Farbwelt + Animation) ist auf die Einstellungen-Seite gewandert. */}
        <ModeToggle />
        {/* Der Name: Profil + Einstellungen als Flyout. */}
        <ProfileMenu />
        <button onClick={logout}>Abmelden</button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/charaktere" element={<CharaktereePage />} />
          <Route path="/gruppen" element={<GruppenPage />} />
          <Route path="/profil" element={<ProfilPage />} />
          <Route path="/verwaltung" element={user.isGm || user.isAdmin ? <AdminPage /> : <Navigate to="/charaktere" />} />
          {/* Einstellungen stehen auch dem Spielleiter offen (u. a. für die
              Farbwelt); die Seite selbst beschränkt ihn serverseitig auf
              die eigenen Charaktere (owner_user_id), nie auf fremde. */}
          <Route path="/einstellungen" element={<EinstellungenPage />} />
          <Route path="/gruppe/:id" element={<GroupPage />} />
          <Route path="/gruppe/:id/uebersicht" element={user.isGm ? <GroupOverviewPage /> : <Navigate to="/charaktere" />} />
          <Route path="/event/:id/uebersicht" element={user.isGm ? <GroupOverviewPage kind="temp" /> : <Navigate to="/charaktere" />} />
          <Route path="/charakter/:id" element={<CharacterPage />} />
          <Route path="/charakter/:id/zauber-faehigkeiten" element={<AbilityManagerPage />} />
          {/* Splat-Route: das Wiki bringt seine eigenen Unterrouten mit. Steht
              vor dem Auffang-* darunter. */}
          <Route path="/wiki/*" element={<WikiRoutes />} />
          <Route path="/changelog" element={<ChangelogPage />} />
          <Route path="*" element={<Navigate to="/charaktere" />} />
        </Routes>
      </main>
      <DicePanelDock />
      </DicePanelProvider>
      </WikiNewsProvider>
      </RequestsProvider>
      </OverviewProvider>
      </ThemeControlsContext.Provider>
    </AuthContext.Provider>
  );
}
