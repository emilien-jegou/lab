import { Schema } from 'effect';
import { describe, it, expect } from 'vitest';

import { document } from '../../api';
import { dbschema } from '../../api-builder';
import type { DeleteStatement } from '../../ast';
import { mockEngine, useAstCapture } from '../test-utils';

const SessionDoc = document('session', Schema.Any);
const db = dbschema(SessionDoc).connect(mockEngine);

describe('DELETE Query Builder', () => {
  const { capture } = useAstCapture();

  it('maps DELETE correctly', () => {
    const ast = capture<DeleteStatement>(
      db
        .doc('session')
        .remove()
        .first()
        .where({ expired: true })
        .returns('BEFORE')
        .timeout('10s'),
    );
    expect(ast.type).toBe('DELETE');
    expect(ast.only).toBe(true);
    expect(ast.return).toEqual({ type: 'KEYWORD', value: 'BEFORE' });
  });
});
