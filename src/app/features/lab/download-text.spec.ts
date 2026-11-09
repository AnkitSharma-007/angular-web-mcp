import { copyText, downloadText } from './download-text';

describe('downloadText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves the text as a named file through a temporary object URL', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    downloadText('act-evals.json', '{"a":1}');

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe('{"a":1}');
    expect(blob.type).toBe('application/json');
    const clicked = click.mock.contexts[0] as HTMLAnchorElement;
    expect(clicked.download).toBe('act-evals.json');
    expect(clicked.href).toBe('blob:test');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('accepts another media type', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadText('rows.md', '| a |', 'text/markdown');
    expect((createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe('text/markdown');
  });
});

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes to the clipboard and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('row')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('row');
  });

  it('reports failure when the clipboard rejects', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    expect(await copyText('row')).toBe(false);
  });

  it('reports failure when there is no clipboard', async () => {
    vi.stubGlobal('navigator', {});
    expect(await copyText('row')).toBe(false);
  });
});
