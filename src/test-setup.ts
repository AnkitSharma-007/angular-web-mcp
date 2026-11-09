globalThis.fetch = () => {
  throw new Error('Unexpected network call: fetch is disabled in unit tests');
};
