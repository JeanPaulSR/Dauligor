const WORKER_URL = import.meta.env.VITE_R2_WORKER_URL as string;
const API_SECRET = import.meta.env.VITE_R2_API_SECRET as string;

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

export function r2Upload(
  file: File,
  key: string,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; key: string }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('key', key);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${WORKER_URL}/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${API_SECRET}`);

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
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

export async function r2List(prefix: string, delimiter = '/'): Promise<R2ListResult> {
  const params = new URLSearchParams({ prefix, delimiter });
  const res = await fetch(`${WORKER_URL}/list?${params}`, {
    headers: { Authorization: `Bearer ${API_SECRET}` },
  });
  if (!res.ok) throw new Error(`Failed to list storage: ${res.status}`);
  return res.json();
}

export async function r2Delete(key: string): Promise<void> {
  const params = new URLSearchParams({ key });
  const res = await fetch(`${WORKER_URL}/delete?${params}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${API_SECRET}` },
  });
  if (!res.ok) throw new Error(`Failed to delete from storage: ${res.status}`);
}

export async function r2Rename(oldKey: string, newKey: string): Promise<{ url: string; key: string }> {
  const res = await fetch(`${WORKER_URL}/rename`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldKey, newKey }),
  });
  if (!res.ok) throw new Error(`Failed to rename in storage: ${res.status}`);
  return res.json();
}
