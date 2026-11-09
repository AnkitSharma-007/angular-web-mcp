import {
  applyEach,
  email,
  max,
  min,
  required,
  validate,
  type SchemaFn,
} from '@angular/forms/signals';
import {
  PRODUCT_TIERS,
  PROPOSAL_DISCOUNT_MAX,
  SEATS_MAX,
  SEATS_MIN,
  TERM_MAX_MONTHS,
  TERM_MIN_MONTHS,
  isBillingDate,
  isIsoDate,
  type ProposalModel,
} from '../../core/models/proposal';

export const PROPOSAL_TOOL_NAME = 'draftDealProposal';

export const PROPOSAL_TOOL_DESCRIPTION =
  'Use to draft a sales proposal for one deal in the open proposal drawer; fill every field. ' +
  'Fields: dealId (existing deal, like D-1004); clientName; contactEmail; ' +
  `productTier (exactly one of ${PRODUCT_TIERS.join(', ')}); ` +
  `seats (whole number ${SEATS_MIN}-${SEATS_MAX}); termMonths (whole number ` +
  `${TERM_MIN_MONTHS}-${TERM_MAX_MONTHS}); discountPct (0-${PROPOSAL_DISCOUNT_MAX}, above 15 ` +
  'needs human approval and the human may reject); startDate (ISO YYYY-MM-DD and it must be ' +
  'the 1st of a month because of billing cycles); lineItems (non-empty list of product names). ' +
  'Starter allows at most 1000 seats. On failure the result lists each field and what to fix: ' +
  'correct it and call again. Call openProposalDrawer first, this tool only exists while the ' +
  'drawer is open.';

const wholeNumber = (value: number) => Number.isInteger(value);

export function proposalSchema(dealExists: (dealId: string) => boolean): SchemaFn<ProposalModel> {
  return (path) => {
    required(path.dealId, { message: 'Deal ID is required' });
    validate(path.dealId, ({ value }) =>
      value() === '' || dealExists(value())
        ? undefined
        : { kind: 'unknown_deal', message: `No deal with ID "${value()}"` },
    );

    required(path.clientName, { message: 'Client name is required' });

    required(path.contactEmail, { message: 'Contact email is required' });
    email(path.contactEmail, { message: 'Enter a valid email address' });

    required(path.productTier, { message: 'Choose a product tier' });
    validate(path.productTier, ({ value }) =>
      PRODUCT_TIERS.includes(value())
        ? undefined
        : {
            kind: 'tier',
            message: `Tier must be one of: ${PRODUCT_TIERS.join(', ')}`,
          },
    );

    required(path.seats, { message: 'Seats is required' });
    min(path.seats, SEATS_MIN, { message: `At least ${SEATS_MIN} seat` });
    max(path.seats, SEATS_MAX, { message: `At most ${SEATS_MAX} seats` });
    validate(path.seats, ({ value }) =>
      wholeNumber(value())
        ? undefined
        : { kind: 'integer', message: 'Seats must be a whole number' },
    );

    required(path.termMonths, { message: 'Term is required' });
    min(path.termMonths, TERM_MIN_MONTHS, {
      message: `Term is at least ${TERM_MIN_MONTHS} months`,
    });
    max(path.termMonths, TERM_MAX_MONTHS, { message: `Term is at most ${TERM_MAX_MONTHS} months` });
    validate(path.termMonths, ({ value }) =>
      wholeNumber(value())
        ? undefined
        : { kind: 'integer', message: 'Term must be a whole number of months' },
    );

    required(path.discountPct, { message: 'Discount is required' });
    min(path.discountPct, 0, { message: 'Discount cannot be negative' });
    max(path.discountPct, PROPOSAL_DISCOUNT_MAX, {
      message: `Discount is at most ${PROPOSAL_DISCOUNT_MAX}%`,
    });

    required(path.startDate, { message: 'Start date is required' });
    validate(path.startDate, ({ value }) => {
      if (value() === '') {
        return undefined;
      }
      if (!isIsoDate(value())) {
        return { kind: 'date_format', message: 'Use an ISO date, YYYY-MM-DD' };
      }
      return isBillingDate(value())
        ? undefined
        : {
            kind: 'billing_cycle',
            message:
              'Start date must be the 1st of a month (billing cycle), for example 2027-01-01',
          };
    });

    required(path.lineItems);
    validate(path.lineItems, ({ value }) =>
      value().length > 0 ? undefined : { kind: 'required', message: 'Add at least one line item' },
    );
    applyEach(path.lineItems, (item) => {
      required(item, { message: 'Line item cannot be blank' });
    });
  };
}
