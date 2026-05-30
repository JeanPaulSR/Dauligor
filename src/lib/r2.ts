import { auth } from "./firebase";

export interface R2Object {
  key: string;
  size: number;
  uploaded: string | null;
  url: string;
}

export interface R2ListResult {
  objects: R2Object[];
  delimitedPrefixes: string[];
}

async function getAuthHeaders() {
  if (!auth.currentUser) {
    throw new Error("You must be signed in to manage images.");
  }

  const idToken = await auth.currentUser.getIdToken();
  return {
    Authorization: `Bearer ${idToken}`,
  };
}

async function parseApiResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }

  const errorPayload = await response.json().catch(() => ({}));
  throw new Error(errorPayload.error || `${fallbackMessage}: ${response.status}`);
}

export function r2Upload(
  file: File,
  key: string,
  onProgress?: (pct: number) => void,
  // Active proposal block id. When set, the server allows a non-staff
  // content-creator to upload INTO their own open block (otherwise uploads
  // are staff-gated). Pass `useBlock().activeBundleId` from proposal-mode UI.
  bundleId?: string | null,
): Promise<{ url: string; key: string }> {
  return new Promise(async (resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('key', key);

    let authHeaders: Record<string, string>;
    try {
      authHeaders = await getAuthHeaders();
    } catch (error) {
      reject(error);
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/r2/upload`);
    xhr.setRequestHeader('Authorization', authHeaders.Authorization);
    if (bundleId) xhr.setRequestHeader('X-Proposal-Bundle-Id', bundleId);

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
      };
    }

    xhr.onload = () => {
      if (xhr.status === 200) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Invalid response from storage worker')); }
      } else {
        try {
          const payload = JSON.parse(xhr.responseText);
          reject(new Error(payload.error || `Upload failed: ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

export async function r2List(prefix: string, delimiter: string = '/'): Promise<R2ListResult> {
  const authHeaders = await getAuthHeaders();
  // An empty delimiter means "fully recursive" — omit the param entirely so the
  // worker passes `undefined` to BUCKET.list rather than an empty string (R2's
  // behaviour with empty-string delimiter is undefined and observed to behave
  // like a shallow listing rather than a recursive one).
  const params = new URLSearchParams({ prefix });
  if (delimiter) params.set('delimiter', delimiter);
  const res = await fetch(`/api/r2/list?${params}`, {
    headers: authHeaders,
  });
  return parseApiResponse<R2ListResult>(res, 'Failed to list storage');
}

export async function r2Delete(key: string): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const params = new URLSearchParams({ key });
  const res = await fetch(`/api/r2/delete?${params}`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  await parseApiResponse<{ success: boolean }>(res, 'Failed to delete from storage');
}

export async function r2MoveFolder(
  oldPrefix: string,
  newPrefix: string,
  onProgress?: (moved: number) => void,
): Promise<{ count: number }> {
  const authHeaders = await getAuthHeaders();
  let total = 0;
  let done = false;
  do {
    const res = await fetch(`/api/r2/move-folder`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPrefix, newPrefix }),
    });
    const data = await parseApiResponse<{ count: number; done: boolean }>(res, 'Failed to move folder');
    total += data.count;
    done = data.done;
    onProgress?.(total);
    await new Promise(resolve => setTimeout(resolve, 0));
  } while (!done);
  return { count: total };
}

// Recursively delete every object under `prefix`. There's no dedicated worker
// endpoint for this; we list (up to 1000 at a time, R2's page size) and
// concurrently delete via the single-key /delete endpoint. The list+delete
// loop continues until a list comes back empty, so this also picks up any
// stragglers that landed between batches. Reports running `deleted` count via
// onProgress; the caller can pre-count with its own list-walk if a percent
// readout is needed.
export async function r2DeleteFolder(
  prefix: string,
  onProgress?: (deleted: number) => void,
  concurrency = 10,
): Promise<{ count: number }> {
  const normalized = prefix.endsWith('/') ? prefix : prefix + '/';
  let totalDeleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const list = await r2List(normalized, '');
    if (list.objects.length === 0) break;
    const keys = list.objects.map((o) => o.key);
    for (let i = 0; i < keys.length; i += concurrency) {
      const batch = keys.slice(i, i + concurrency);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(
        batch.map(async (key) => {
          await r2Delete(key);
          totalDeleted++;
          onProgress?.(totalDeleted);
        }),
      );
    }
  }
  return { count: totalDeleted };
}

export async function r2Rename(oldKey: string, newKey: string): Promise<{ url: string; key: string }> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/r2/rename`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldKey, newKey }),
  });
  return parseApiResponse<{ url: string; key: string }>(res, 'Failed to rename in storage');
}
