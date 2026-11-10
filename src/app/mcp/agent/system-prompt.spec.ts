import { buildSystemPrompt } from './system-prompt';

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt(new Date('2026-11-09T10:00:00Z'));

  it('states today as an ISO date', () => {
    expect(prompt).toContain('Today is 2026-11-09.');
  });

  it('asks for plain text without Markdown or HTML, because the reply is shown raw', () => {
    expect(prompt).toContain('plain text');
    expect(prompt).toMatch(/no Markdown or HTML/);
    expect(prompt).toContain('asterisks');
  });

  it('covers reasons, human rejections and tools that change', () => {
    expect(prompt).toContain('"reason"');
    expect(prompt).toContain('rejects');
    expect(prompt).toContain('can change while you work');
  });
});
