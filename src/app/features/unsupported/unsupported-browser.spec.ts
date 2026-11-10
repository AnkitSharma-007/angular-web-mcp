import { TestBed } from '@angular/core/testing';
import { expectNoA11yViolations } from '../../../testing/a11y';
import { UnsupportedBrowser } from './unsupported-browser';

describe('UnsupportedBrowser', () => {
  async function render() {
    const fixture = TestBed.createComponent(UnsupportedBrowser);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('says WebMCP is missing and how to fix the browser', async () => {
    const root = await render();
    expect(root.querySelector('h1')?.textContent).toContain("doesn't support WebMCP");
    const steps = [...root.querySelectorAll('li')].map((item) => item.textContent);
    expect(steps).toHaveLength(3);
    expect(root.textContent).toContain('Chrome 158');
    expect(root.textContent).toContain('chrome://flags/#enable-webmcp-testing');
  });

  it('names the browser it detected', async () => {
    const root = await render();
    expect(root.textContent).toMatch(
      /Detected: (Chromium \d+|a browser that is not Chromium-based)\./,
    );
  });

  it('is free of axe violations', async () => {
    await expectNoA11yViolations(await render());
  });
});
