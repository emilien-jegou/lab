import { Schema } from 'effect';
import { describe, it, expect } from 'vitest';

import { document } from '../../api';
import { dbschema } from '../../api-builder';
import type { InsertStatement } from '../../ast';
import { mockEngine, useAstCapture } from '../test-utils';

const UserDoc = document('user', Schema.Struct({ name: Schema.String, role: Schema.String }));
const db = dbschema(UserDoc).connect(mockEngine);

describe('INSERT Query Builder', () => {
  const { capture } = useAstCapture();

  it('builds INSERT INTO with ignore, onDuplicate, and returns', () => {
    const ast = capture<InsertStatement>(
      db
        .doc('user')
        .insert({ name: 'Alice', role: 'admin' })
        .ignore()
        .onDuplicate({ role: 'admin' })
        .returns('AFTER'),
    );

    expect(ast.type).toBe('INSERT');
    expect(ast.ignore).toBe(true);
    expect(ast.onDuplicate?.type).toBe('SET');
    expect(ast.return).toEqual({ type: 'KEYWORD', value: 'AFTER' });
  });
});
