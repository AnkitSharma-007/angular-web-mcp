import axe from 'axe-core';

export async function expectNoA11yViolations(root: Element = document.body): Promise<void> {
  const results = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false } },
  });
  if (results.violations.length > 0) {
    const summary = results.violations.map(
      (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    );
    throw new Error(`Accessibility violations:\n${summary.join('\n')}`);
  }
}
