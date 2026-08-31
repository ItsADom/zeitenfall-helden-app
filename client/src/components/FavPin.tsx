// 📌 Favorit fürs Würfel-Dock (ShortcutsFlyout.tsx) — auf Talent-/Ability-
// Zeilen (Talente.tsx, AbilityTable.tsx, AbilityManager.tsx). ★/☆ war schon
// doppelt vergeben (Signatur-Zauber, 100-TaW-Meisterschaft), deshalb ein
// eigenes Symbol statt eines dritten Sterns.
export function FavPin({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`fav-pin${active ? ' on' : ''}`}
      title={active ? 'Aus Würfel-Favoriten entfernen' : 'Als Würfel-Favorit merken'}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      📌
    </button>
  );
}
