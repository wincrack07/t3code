/**
 * The address row's resting text: host first, so the end that truncates is the path.
 * Only http(s) is shortened; other schemes and unparseable input stay as typed.
 */
export function formatAddressForDisplay(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return `${parsed.host}${path}${parsed.search}${parsed.hash}`;
}
