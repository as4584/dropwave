import Constants from 'expo-constants';

/**
 * Backend base URL. On Lex's phone, localhost will not reach the VM, so set
 * EXPO_PUBLIC_API_URL to the machine's LAN IP or a tunnel URL, e.g.
 * EXPO_PUBLIC_API_URL=http://192.168.1.50:8001 npx expo start
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
  'http://localhost:8001';

export interface QualityOption {
  id: string;
  label: string;
  bitrate: number;
  ext: string;
  estBytes: number | null;
}

export type TrackSource = 'youtube' | 'spotify' | 'apple';

export interface ProbeResult {
  title: string;
  artist: string;
  durationSec: number | null;
  thumbnail: string | null;
  source: TrackSource;
  matchedFromYoutube: boolean;
  resolvedUrl: string;
  qualities: QualityOption[];
}

export async function probeUrl(url: string): Promise<ProbeResult> {
  const res = await fetch(`${API_BASE_URL}/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    let detail = `Probe failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // keep generic message
    }
    throw new Error(detail);
  }
  return (await res.json()) as ProbeResult;
}

/** GET download URL for expo-file-system (it cannot POST a body). */
export function downloadUrl(url: string, quality: string, resolvedUrl?: string): string {
  const q = new URLSearchParams({ url, quality });
  if (resolvedUrl) q.set('resolvedUrl', resolvedUrl);
  return `${API_BASE_URL}/download?${q.toString()}`;
}

export async function checkBackend(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    const body = await res.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}
