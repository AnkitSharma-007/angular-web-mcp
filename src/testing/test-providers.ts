import {
  installFakeModelContext,
  uninstallFakeModelContext,
  type FakeModelContext,
} from './fake-model-context';

export function useFakeModelContext(): { readonly current: FakeModelContext } {
  let fake: FakeModelContext | undefined;
  beforeEach(() => {
    fake = installFakeModelContext();
  });
  afterEach(() => {
    fake?.reset();
    uninstallFakeModelContext();
  });
  return {
    get current() {
      if (!fake) throw new Error('useFakeModelContext(): accessed outside a test');
      return fake;
    },
  };
}
