import { signalStore, withHooks } from '@ngrx/signals';
import { withAgentHistory } from '../../../core/store-features/with-agent-history';
import { withDeals } from './with-deals';

export const DealsStore = signalStore(
  withDeals(),
  withAgentHistory({ capacity: 20 }),
  withHooks({ onInit: (store) => store.reset() }),
);
