import { describeBrowser } from './detect-browser';

describe('describeBrowser', () => {
  it('reports the Chromium major version', () => {
    expect(
      describeBrowser(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ),
    ).toBe('Chromium 120');
  });

  it('says so when the browser is not Chromium-based', () => {
    expect(
      describeBrowser(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0',
      ),
    ).toBe('a browser that is not Chromium-based');
    expect(describeBrowser('')).toBe('a browser that is not Chromium-based');
  });
});
