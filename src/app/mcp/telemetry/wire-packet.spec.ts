import { REDACTED, byteLength, redactSecrets } from './wire-packet';

const KEY = 'AIzaSyFAKEKEY1234567890';

describe('redactSecrets', () => {
  it('masks the x-goog-api-key header in any casing', () => {
    expect(redactSecrets({ headers: { 'X-Goog-Api-Key': KEY, accept: 'json' } })).toEqual({
      headers: { 'X-Goog-Api-Key': REDACTED, accept: 'json' },
    });
  });

  it('masks key= query values and keeps the rest of the url', () => {
    expect(redactSecrets({ url: 'https://x.test/v1?alt=sse&key=abc123&b=1' })).toEqual({
      url: `https://x.test/v1?alt=sse&key=${REDACTED}&b=1`,
    });
  });

  it('masks the raw key wherever it appears, including nested arrays and object keys', () => {
    const input = { parts: [{ text: `use ${KEY} now` }], [KEY]: 'x' };
    const output = JSON.stringify(redactSecrets(input, [KEY]));
    expect(output).not.toContain(KEY);
    expect(output).toContain(`use ${REDACTED} now`);
  });

  it('ignores secrets that are too short to be a real key', () => {
    expect(redactSecrets({ text: 'a cat sat' }, ['a'])).toEqual({ text: 'a cat sat' });
  });

  it('passes primitives through and does not mutate its input', () => {
    const input = { n: 1, b: true, z: null, text: 'key=abc' };
    expect(redactSecrets(input)).toEqual({ n: 1, b: true, z: null, text: `key=${REDACTED}` });
    expect(input.text).toBe('key=abc');
  });
});

describe('byteLength', () => {
  it('counts utf-8 bytes of the json form', () => {
    expect(byteLength({ a: 1 })).toBe(7);
    expect(byteLength('•')).toBe(5);
    expect(byteLength(undefined)).toBe(0);
  });
});
