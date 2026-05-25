export function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;

  let normalized = url.trim();
  if (normalized.startsWith('//')) {
    normalized = `https:${normalized}`;
  } else if (/^http:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^http:\/\//i, 'https://');
  }

  if (!/^https:\/\//i.test(normalized)) {
    return null;
  }

  if (/media-amazon\.com|images-amazon\.com|ssl-images-amazon/i.test(normalized)) {
    normalized = normalized.replace(/\._AC_[A-Z0-9]+_/g, '._AC_SL1500_');
  }

  return normalized;
}
