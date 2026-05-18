// Lightweight module-level cache for the current user's role.
// Set by App.tsx whenever the userProfile changes; read by components
// that aren't on the userProfile prop-drill chain (e.g. IconPickerModal).
// Server endpoints still authoritatively gate writes — this is a UX hint.

let currentRole: string | null = null;

export function setCurrentUserRole(role: string | null) {
  currentRole = role;
}

export function getCurrentUserRole(): string | null {
  return currentRole;
}

export function isAdmin(): boolean {
  return currentRole === 'admin';
}
