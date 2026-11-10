import {
  DEFAULT_MODEL_ID,
  GEMINI_MODELS,
  estimateCostUsd,
  findModel,
  priceAt,
} from './gemini-models';

const USAGE = { input: 1_000_000, output: 1_000_000, thinking: 0 };

describe('Gemini model catalog', () => {
  it('lists two models with the Operator as the default', () => {
    expect(GEMINI_MODELS.map((model) => model.persona)).toEqual(['Sprinter', 'Operator']);
    expect(findModel(DEFAULT_MODEL_ID)?.persona).toBe('Operator');
  });

  it('maps each persona to its thinking level', () => {
    expect(GEMINI_MODELS.map((model) => model.thinkingLevel)).toEqual(['low', 'medium']);
  });

  it('returns undefined for an unknown model', () => {
    expect(findModel('gemini-1.0')).toBeUndefined();
    expect(estimateCostUsd('gemini-1.0', USAGE, new Date())).toBeUndefined();
  });

  it('switches the Operator to the higher price on 2027-01-01', () => {
    const operator = findModel('gemini-3.8-flash')!;
    expect(priceAt(operator, new Date('2026-12-31T12:00:00Z')).inputPerM).toBe(0.75);
    expect(priceAt(operator, new Date('2027-01-01T00:00:00Z')).inputPerM).toBe(1.5);
  });

  it('prices a run at the rate for the given date', () => {
    expect(
      estimateCostUsd('gemini-3.8-flash', USAGE, new Date('2026-11-09T00:00:00Z')),
    ).toBeCloseTo(4.5);
    expect(
      estimateCostUsd('gemini-3.8-flash', USAGE, new Date('2027-01-02T00:00:00Z')),
    ).toBeCloseTo(9);
  });

  it('bills thinking tokens at the output rate', () => {
    const at = new Date('2026-11-09T00:00:00Z');
    const withThinking = estimateCostUsd(
      'gemini-3.5-flash-lite',
      { input: 0, output: 0, thinking: 1_000_000 },
      at,
    );
    expect(withThinking).toBeCloseTo(2.5);
  });
});
