const PREFIX = "gl.seen.";

export function hasSeen(id: string): boolean {
  try {
    return localStorage.getItem(PREFIX + id) === "1";
  } catch {
    return true;
  }
}

export function markSeen(id: string) {
  try {
    localStorage.setItem(PREFIX + id, "1");
  } catch {
    /* private mode — just don't persist */
  }
}

export function resetSeen() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
