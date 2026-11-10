export function describeBrowser(userAgent: string): string {
  const chromium = /Chrome\/(\d+)/.exec(userAgent);
  return chromium ? `Chromium ${chromium[1]}` : 'a browser that is not Chromium-based';
}
