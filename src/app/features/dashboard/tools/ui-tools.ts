import type { Signal, WebMcpToolDescriptor } from '@angular/core';
import type { Deal } from '../../../core/models/deal';
import { defineTool } from '../../../mcp/tooling/define-tool';
import { ToolInputError } from '../../../mcp/tooling/tool-errors';
import { PROPOSAL_TOOL_NAME } from '../../proposal/proposal-form';

export interface UiToolsStore {
  readonly proposalOpen: Signal<boolean>;
  openProposal(dealId?: string): void;
}

export interface DealLookup {
  readonly entityMap: Signal<Readonly<Record<string, Deal | undefined>>>;
}

interface OpenProposalArgs {
  dealId: string;
}

export function dashboardUiTools(ui: UiToolsStore, deals: DealLookup): WebMcpToolDescriptor[] {
  const openProposalDrawer = defineTool<OpenProposalArgs>({
    name: 'openProposalDrawer',
    title: 'Open proposal drawer',
    description:
      'Use first when the user wants a proposal, quote or renewal drafted for a deal. Opens the ' +
      `proposal drawer prefilled from the deal. The ${PROPOSAL_TOOL_NAME} tool only appears ` +
      'after this runs, so refresh your tool list and then call it. Changes the view only, ' +
      'never the deal. Needs an exact ID from searchDeals.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['dealId'],
      properties: { dealId: { type: 'string', pattern: '^D-\\d{4}$' } },
    },
    run: ({ dealId }) => {
      const deal = deals.entityMap()[dealId];
      if (!deal) {
        throw new ToolInputError(`Unknown deal ${dealId}. Use searchDeals to find a valid ID`);
      }
      const alreadyOpen = ui.proposalOpen();
      ui.openProposal(dealId);
      return {
        opened: true,
        alreadyOpen,
        dealId,
        account: deal.account,
        nextTool: PROPOSAL_TOOL_NAME,
      };
    },
  });

  return [openProposalDrawer];
}
