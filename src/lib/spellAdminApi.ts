import { auth } from './firebase';

async function getAuthHeaders() {
  if (!auth.currentUser) {
    throw new Error('You must be signed in as an admin to manage spells.');
  }

  const idToken = await auth.currentUser.getIdToken();
  return {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json'
  };
}

async function parseApiResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`${fallbackMessage} endpoint not found. Restart the dev server so the new admin route is loaded.`);
    }
    throw new Error(payload.error || fallbackMessage);
  }
  return payload as T;
}

export async function adminUpsertSpell(id: string | null, payload: Record<string, any>) {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/admin/spells/upsert', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id, payload })
  });
  return parseApiResponse<{ success: boolean; id: string; action: 'created' | 'updated' }>(response, 'Failed to save spell.');
}

export async function adminImportSpellBatch(entries: { id: string | null; payload: Record<string, any> }[]) {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/admin/spells/import-batch', {
    method: 'POST',
    headers,
    body: JSON.stringify({ entries })
  });
  return parseApiResponse<{ success: boolean; total: number; created: number; updated: number }>(response, 'Failed to import spells.');
}

export async function adminDeleteSpell(id: string) {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/admin/spells/delete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id })
  });
  return parseApiResponse<{ success: boolean; id: string }>(response, 'Failed to delete spell.');
}
