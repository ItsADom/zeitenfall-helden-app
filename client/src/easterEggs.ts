// Hook point for the not-yet-built easter-egg tracker (TODO.md "Easter egg
// tracker"): once that public leaderboard/backend exists, this should POST
// to `/easter-eggs/:key/found`. Until then it's a no-op, so a trigger can be
// wired up to it from the start instead of bolting the call on later.
export function reportEasterEggFound(key: string): void {
  void key;
}
