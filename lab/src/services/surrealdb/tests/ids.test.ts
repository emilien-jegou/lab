import { describe, it, expect } from 'vitest';

import { id } from '../api-builder';

describe('SurrealODM Core & IDs', () => {
  it('generates strict Record IDs securely', () => {
    const simpleId = id('user', 'jaime');
    expect(simpleId._tag).toBe('SurrealID');
    expect(simpleId.table).toBe('user');
    expect(simpleId.value).toBe('jaime');
    expect(simpleId.toString()).toBe('user:"jaime"');
  });
});
