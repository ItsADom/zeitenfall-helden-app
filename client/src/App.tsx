import { createContext, useContext, useEffect, useRef, useState } from 'react';
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
import VirtualTablePage from './pages/VirtualTable';
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
import { WartungProvider } from './components/wartung';
import { NeustartOverlay } from './components/NeustartOverlay';
import WichtigerWurfOverlay from './components/dice/WichtigerWurfOverlay';
import DicePanel from './components/dice/DicePanel';
import BannerFx from './components/BannerFx';
import { useTopbarHeight } from './components/stickyChrome';
import { isKnownTheme, useAnimations, useChatFontSize, useDiceIcons, useMode, useTheme } from './theme';
import type { ChatFontSize, Mode } from './theme';
import { reportEasterEggFound } from './easterEggs';

// Geheimer "Chaos"-Modus (TODO.md „Secret chaos mode easter egg"): 5x schnell
// auf den banner-fx-Streifen klicken löst kurzzeitig eine grelle, absichtlich
// unpassende Farbwelt aus. Bewusst NICHT Teil von THEMES (theme.ts) — ein Gag,
// keine wählbare/gespeicherte Farbwelt.
// Vorerst ABGESCHALTET: reportEasterEggFound() ist noch ein Stub (kein
// Server, kein Tracker — siehe TODO.md „Easter egg tracker"). Wer das Ei
// jetzt schon findet, würde einen ungetrackten Vorsprung haben, sobald die
// Rangliste live geht. Auf true stellen, sobald der Tracker steht.
const CHAOS_MODE_ENABLED = false;
const CHAOS_THEME_ID = 'chaos';
const CHAOS_CLICKS_NEEDED = 5;
const CHAOS_CLICK_WINDOW_MS = 1500;
const CHAOS_DURATION_MS = 12000;

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
  diceIcons: boolean;
  setDiceIcons: (on: boolean) => void;
  chatFontSize: ChatFontSize;
  setChatFontSize: (id: ChatFontSize) => void;
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
  const [diceIcons, setDiceIcons] = useDiceIcons();
  const [chatFontSize, setChatFontSize] = useChatFontSize();
  // Überschreibende Farbwelt eines geöffneten Charakters (null = persönliche
  // Vorgabe). Die angezeigte Farbwelt treibt data-theme UND die Kopf-Animation,
  // damit auf der Charakterseite beides zur Charakter-Farbwelt passt.
  const [overrideTheme, setOverrideTheme] = useState<string | null>(null);
  const displayTheme = overrideTheme && isKnownTheme(overrideTheme) ? overrideTheme : theme;
  // Chaos-Modus: eigener Schalter statt über setTheme/setOverrideTheme, damit
  // er weder persistiert noch die Charakter-Override-Farbwelt anfasst — läuft
  // rein am displayTheme vorbei und legt sich nach Ablauf selbst wieder ab.
  const [chaosMode, setChaosMode] = useState(false);
  const chaosClicksRef = useRef<number[]>([]);
  const chaosTimeoutRef = useRef<number | undefined>(undefined);
  const appliedTheme = chaosMode ? CHAOS_THEME_ID : displayTheme;
  useEffect(() => {
    document.documentElement.dataset.theme = appliedTheme;
  }, [appliedTheme]);
  useEffect(() => () => window.clearTimeout(chaosTimeoutRef.current), []);
  const handleBannerClick = () => {
    if (!CHAOS_MODE_ENABLED || chaosMode) return;
    const now = Date.now();
    const recent = [...chaosClicksRef.current, now].filter((t) => now - t <= CHAOS_CLICK_WINDOW_MS);
    chaosClicksRef.current = recent;
    if (recent.length < CHAOS_CLICKS_NEEDED) return;
    chaosClicksRef.current = [];
    setChaosMode(true);
    reportEasterEggFound('chaos-mode');
    window.clearTimeout(chaosTimeoutRef.current);
    chaosTimeoutRef.current = window.setTimeout(() => setChaosMode(false), CHAOS_DURATION_MS);
  };
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
      <ThemeControlsContext.Provider
        value={{ theme, setTheme, mode, setMode, anim, setAnim, diceIcons, setDiceIcons, chatFontSize, setChatFontSize, setOverrideTheme }}
      >
      <OverviewProvider>
      <RequestsProvider enabled={user.isGm || user.isAdmin}>
      {/* Für alle: das Wiki gehört jedem, und das Abzeichen zählt, was seit dem
          letzten Blick in die Änderungen dazugekommen ist. */}
      <WikiNewsProvider>
      {/* Umschließt den DicePanelProvider, damit dessen Socket die Wartungs-
          Ansage direkt weiterreichen kann. */}
      <WartungProvider>
      <DicePanelProvider>
      {/* Chaos-Hue-Animation (styles.css) hängt an dieser Hülle, NICHT an body:
          filter macht sein Element zum containing block für position:fixed-
          Nachkommen, und der Würfel-Dock/die Overlays unten sind bewusst
          außerhalb dieser Hülle, damit sie beim Scrollen während des Chaos-
          Fensters weiter am echten Viewport kleben. */}
      <div className="chaos-hue-wrap">
      <header className="topbar" ref={topbarRef}>
        <div className="banner-fx" aria-hidden="true" onClick={handleBannerClick}>
          {/* animate mit in den Key: ändert der Nutzer den Schalter, baut sich
              der Effekt neu auf (Schleife ⇄ Standbild). */}
          <BannerFx key={`${appliedTheme}-${anim}`} theme={appliedTheme} animate={anim} />
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
          {/* Virtueller Tisch: eine Seite für beide Gruppenarten (wie GroupPage
              schon, siehe dort), die Route selbst unterscheidet nicht — group.isTemp
              aus den geladenen Daten entscheidet über Beschriftung/Rücksprung. */}
          <Route path="/gruppe/:id/tisch" element={<VirtualTablePage />} />
          {/* Event-Gruppen bekamen bislang keine eigene Spielerseite — nur die
              GM-Übersicht und den Chat-Dock-Raumwähler. GroupPage bedient beide
              Gruppenarten schon serverseitig (group.isTemp), also reicht die
              zweite Route auf dieselbe Komponente. */}
          <Route path="/event/:id" element={<GroupPage />} />
          <Route path="/event/:id/uebersicht" element={user.isGm ? <GroupOverviewPage /> : <Navigate to="/charaktere" />} />
          <Route path="/event/:id/tisch" element={<VirtualTablePage />} />
          <Route path="/charakter/:id" element={<CharacterPage />} />
          <Route path="/charakter/:id/zauber-faehigkeiten" element={<AbilityManagerPage />} />
          {/* Splat-Route: das Wiki bringt seine eigenen Unterrouten mit. Steht
              vor dem Auffang-* darunter. */}
          <Route path="/wiki/*" element={<WikiRoutes />} />
          <Route path="/changelog" element={<ChangelogPage />} />
          <Route path="*" element={<Navigate to="/charaktere" />} />
        </Routes>
      </main>
      </div>
      <DicePanelDock />
      {/* Over the dock (which it ends by flying into), but under the restart
          screen: a redeploy beats any performance. */}
      <WichtigerWurfOverlay />
      {/* Ganz zuletzt und außerhalb von <main>: der Wartebildschirm muss alles
          überdecken, den Würfel-Dock eingeschlossen. */}
      <NeustartOverlay />
      </DicePanelProvider>
      </WartungProvider>
      </WikiNewsProvider>
      </RequestsProvider>
      </OverviewProvider>
      </ThemeControlsContext.Provider>
    </AuthContext.Provider>
  );
}
