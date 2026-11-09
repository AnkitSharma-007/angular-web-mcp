import { TestBed } from '@angular/core/testing';
import { GENAI_CLIENT_FACTORY } from './genai-client';

describe('GENAI_CLIENT_FACTORY', () => {
  it('creates the real SDK client lazily without touching the network', async () => {
    const create = TestBed.inject(GENAI_CLIENT_FACTORY);
    const client = await create('AIza-test-key-0001');
    expect(typeof client.models.list).toBe('function');
    expect(typeof client.chats.create).toBe('function');
  });
});
