import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

// Eine `.card`, die als Ganzes anklickbar zu `to` navigiert — nicht nur ein
// Link-Fragment darin. Interaktive Kind-Elemente (ein Select, ein eigener
// Link im Namen fürs Mittelklick-Öffnen) rufen `e.stopPropagation()` in ihrem
// eigenen onClick, damit sie nicht mit-navigieren.
export default function ClickableCard({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div
      className={`card card--clickable${className ? ` ${className}` : ''}`}
      onClick={() => navigate(to)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate(to);
      }}
    >
      {children}
    </div>
  );
}
