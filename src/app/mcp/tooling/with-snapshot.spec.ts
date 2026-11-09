import { takeSnapshot } from './with-snapshot';

describe('takeSnapshot', () => {
  it('records the label derived from the args and returns the id', () => {
    const recordSnapshot = vi.fn(() => 'h-3');
    const id = takeSnapshot({ target: { recordSnapshot }, label: (n: number) => `n=${n}` }, 4);
    expect(id).toBe('h-3');
    expect(recordSnapshot).toHaveBeenCalledExactlyOnceWith('n=4');
  });
});
