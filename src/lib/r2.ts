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

export async function r2List(prefix: string, delimiter = '/'): Promise<R2ListResult> {
  const authHeaders = await getAuthHeaders();
  const params = new URLSearchParams({ prefix, delimiter });
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

export async function r2Rename(oldKey: string, newKey: string): Promise<{ url: string; key: string }> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/r2/rename`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldKey, newKey }),
  });
  return parseApiResponse<{ url: string; key: string }>(res, 'Failed to rename in storage');
}
