// Utility to extract numeric Threads post ID from a Threads post page HTML
export function parseThreadsNumericIdFromHtml(html: string): string | null {
  if (!html) return null;

  // Find all <script type="application/json" data-sjs>...</script>
  const scriptRegex = /<script\b[^>]*type=["']application\/json["'][^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const inner = match[1].trim();
    if (!inner) continue;
    // Try parse as JSON
    try {
      const obj = JSON.parse(inner);
      const found = findNumericIdInObject(obj);
      if (found) return found;
    } catch (_) {
      // Try to clean common wrappers like HTML comments
      const cleaned = inner.replace(/^<!--/, '').replace(/-->$/, '').trim();
      try {
        const obj = JSON.parse(cleaned);
        const found = findNumericIdInObject(obj);
        if (found) return found;
      } catch (_) {
        // ignore
      }
    }
  }

  // Fallbacks: search HTML text for common patterns
  // 1) "pk": 18297320887283438  (number or string)
  const pkRegex = /"pk"\s*:\s*(?:")?(\d{6,})(?:")?/;
  const pkMatch = html.match(pkRegex);
  if (pkMatch) return pkMatch[1];

  // 2) "id":"18297320887283438_12345"
  const idRegex = /"id"\s*:\s*"(\d{6,})_\d+"/;
  const idMatch = html.match(idRegex);
  if (idMatch) return idMatch[1];

  // 3) any long number (best-effort)
  const longNum = html.match(/(\d{12,})/);
  if (longNum) return longNum[1];

  return null;
}

function findNumericIdInObject(obj: any): string | null {
  if (obj == null) return null;
  if (typeof obj === 'number') {
    // Heuristic: Threads numeric IDs are large ( > 1e6 )
    if (obj > 1000000) return String(obj);
    return null;
  }
  if (typeof obj === 'string') {
    if (/^\d{6,}$/.test(obj)) return obj;
    const m = obj.match(/^(\d{6,})_\d+/);
    if (m) return m[1];
    return null;
  }
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const f = findNumericIdInObject(it);
      if (f) return f;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      // Prefer explicit pk/id keys
      if (key === 'pk' || key === 'post_pk' || key === 'postId' || key === 'post_id' || key === 'id') {
        const f = findNumericIdInObject(val);
        if (f) return f;
      }
    }
    // Generic walk
    for (const key of Object.keys(obj)) {
      const f = findNumericIdInObject(obj[key]);
      if (f) return f;
    }
  }
  return null;
}

export async function fetchThreadsPostNumericIdFromUrl(url: string): Promise<string | null> {
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const html = await res.text();
  return parseThreadsNumericIdFromHtml(html);
}

export default parseThreadsNumericIdFromHtml;


