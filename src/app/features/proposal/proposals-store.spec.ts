import { TestBed } from '@angular/core/testing';
import { createProposalModel } from '../../core/models/proposal';
import { CLOCK } from '../../core/util/clock';
import { ProposalsStore } from './proposals-store';

describe('ProposalsStore', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        ProposalsStore,
        { provide: CLOCK, useValue: () => new Date('2026-11-09T10:00:00Z') },
      ],
    });
    return TestBed.inject(ProposalsStore);
  }

  it('starts empty', () => {
    const store = setup();
    expect(store.entities()).toEqual([]);
    expect(store.latest()).toBeNull();
  });

  it('saves numbered drafts with a timestamp and a copy of the line items', () => {
    const store = setup();
    const model = { ...createProposalModel({ dealId: 'D-1001' }), clientName: 'Konkan Freight' };
    const first = store.saveDraft(model);
    const second = store.saveDraft(model);
    expect([first.id, second.id]).toEqual(['P-0001', 'P-0002']);
    expect(first.savedAt).toBe('2026-11-09T10:00:00.000Z');
    expect(first.lineItems).not.toBe(model.lineItems);
    expect(store.latest()).toEqual(second);
    expect(store.entities()).toHaveLength(2);
  });
});
