import { expectNoA11yViolations } from './a11y';

describe('expectNoA11yViolations', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('passes for accessible markup', async () => {
    const button = document.createElement('button');
    button.textContent = 'Save';
    document.body.append(button);
    await expect(expectNoA11yViolations(button)).resolves.toBeUndefined();
  });

  it('fails for an unlabelled control', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    await expect(expectNoA11yViolations(button)).rejects.toThrow(/button-name/);
  });
});
