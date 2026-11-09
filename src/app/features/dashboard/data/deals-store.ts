import { signalStore, withFeature, withHooks } from '@ngrx/signals';
import { withAgentHistory } from '../../../core/store-features/with-agent-history';
import { withWebMcpTools } from '../../../mcp/store-features/with-webmcp-tools';
import { dealMutationTools } from '../tools/deal-mutation-tools';
import { withDeals } from './with-deals';

export const DealsStore = signalStore(
  withDeals(),
  withAgentHistory({ capacity: 20 }),
  withHooks({ onInit: (store) => store.reset() }),
  withFeature((store) => withWebMcpTools(() => dealMutationTools(store))),
);
