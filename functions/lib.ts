// Shared helpers for the app's Contentful Functions.

const CMA_BASE = 'https://api.contentful.com';

export type CmaFetch = (
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
) => Promise<any>;

// Minimal CMA REST helper on fetch — keeps function bundles free of heavy SDK imports.
export function makeCmaFetch(token: string): CmaFetch {
  return async (method, path, body, headers = {}) => {
    const res = await fetch(`${CMA_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/vnd.contentful.management.v1+json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      const err: any = new Error(`${method} ${path} → ${res.status}: ${text}`);
      err.status = res.status;
      throw err;
    }
    // 204s and publishes may return empty bodies
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  };
}

// Extract a human title from an entry payload (mirrors the frontend heuristic)
export function extractTitle(data: any, fallback: string): string {
  const fields = data?.fields || {};
  for (const name of ['internalName', 'title', 'name', 'headline', 'label']) {
    const field = fields[name];
    if (field) {
      const value = field[Object.keys(field)[0]];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return fallback;
}
