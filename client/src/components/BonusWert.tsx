// Markiert eine Zelle als item-bonusiert: nur eine Farbe + ein Tooltip, das
// die beitragenden Gegenstände nennt. Nimmt `children` statt eines eigenen
// `value`/`format`, damit es sich um eine bereits fertige Anzeige legen lässt
// (z. B. MaximumWert, das selbst schon sein eigenes Gekappt-Verhalten hat) —
// eine Stelle für Heldenbrief, Talente und SidebarPools, siehe
// docs/concepts/item-bonus-while-worn.md.
export function BonusWert({ quellen, children }: { quellen: string[] | undefined; children: React.ReactNode }) {
  if (!quellen || quellen.length === 0) return <>{children}</>;
  return (
    <span className="bonus-mark" title={`Durch getragene Gegenstände: ${quellen.join(', ')}`}>
      {children}
    </span>
  );
}
