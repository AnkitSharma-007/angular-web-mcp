import { findModel } from '../../mcp/agent/gemini/gemini-models';
import { DEMO_PROMPTS, demoPromptFor, demoPromptForKey } from './demo-prompts';

describe('demo prompts', () => {
  it('lists one chip per act, in order, bound to hotkeys 1 to 3', () => {
    expect(DEMO_PROMPTS.map((chip) => [chip.id, chip.hotkey])).toEqual([
      ['act1', '1'],
      ['act2', '2'],
      ['act3', '3'],
    ]);
  });

  it('uses the Sprinter for the read-only act and the Operator for the rest', () => {
    expect(DEMO_PROMPTS.map((chip) => chip.model)).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.8-flash',
    ]);
  });

  it('only references models from the catalog', () => {
    for (const chip of DEMO_PROMPTS) {
      expect(findModel(chip.model)).toBeDefined();
    }
  });

  it('keeps the stage prompts unambiguous', () => {
    expect(demoPromptFor('act2').prompt).toContain('Konkan Freight');
    expect(demoPromptFor('act3').prompt).toContain('Monsoon Retail');
  });

  it('finds a chip by hotkey', () => {
    expect(demoPromptForKey('3')?.id).toBe('act3');
    expect(demoPromptForKey('4')).toBeUndefined();
  });

  it('rejects an unknown act', () => {
    expect(() => demoPromptFor('act9' as never)).toThrow('Unknown demo prompt');
  });
});
