import { Schema } from 'effect';
import { describe, it, expect } from 'vitest';

import { document } from '../../api';
import { dbschema } from '../../api-builder';
import type { UpsertStatement } from '../../ast';
import { mockEngine, useAstCapture } from '../test-utils';

const UserDoc = document('user', Schema.Struct({ name: Schema.String, theme: Schema.String }));
const db = dbschema(UserDoc).connect(mockEngine);

describe('UPSERT Query Builder', () => {
  const { capture } = useAstCapture();

  it('builds an UPSERT AST via DocScope.upsert() with SET mode and return AFTER', () => {
    const ast = capture<UpsertStatement>(
      db.doc('user').upsert().set({ theme: 'dark' }).where({ name: 'Alice' }).returns('AFTER'),
    );

    expect(ast.type).toBe('UPSERT');
    expect(ast.targets).toEqual([{ type: 'IDENTIFIER', value: 'user' }]);
    expect(ast.data.type).toBe('SET');
    expect(ast.return).toEqual({ type: 'KEYWORD', value: 'AFTER' });
  });
});
