import { Schema } from 'effect';
import { describe, it, expect } from 'vitest';

import { document } from '../../api';
import { dbschema } from '../../api-builder';
import type { UpdateStatement } from '../../ast';
import { mockEngine, useAstCapture } from '../test-utils';

const UserDoc = document('user', Schema.Any);
const ComplexDoc = document('complex', Schema.Any);

const db = dbschema(UserDoc, ComplexDoc).connect(mockEngine);

describe('UPDATE Query Builder', () => {
  const { capture } = useAstCapture();

  it('handles SET mode', () => {
    const ast = capture<UpdateStatement>(db.doc('user').update().set({ name: 'John' }));
    expect(ast.data.type).toBe('SET');
  });

  it('handles UNSET mode', () => {
    const ast = capture<UpdateStatement>(db.doc('user').update().unset(['password']));
    expect(ast.data).toEqual({ type: 'UNSET', fields: ['password'] });
  });

  it('handles MERGE mode', () => {
    const ast = capture<UpdateStatement>(db.doc('user').update().merge({ theme: 'dark' }));
    expect(ast.data.type).toBe('MERGE');
  });

  it('handles CONTENT mode', () => {
    const ast = capture<UpdateStatement>(db.doc('user').update().content({ id: '1' }));
    expect(ast.data.type).toBe('CONTENT');
  });

  it('handles PATCH mode', () => {
    const ast = capture<UpdateStatement>(
      db
        .doc('complex')
        .update()
        .patch([{ op: 'add', path: '/a', value: 1 }]),
    );
    expect(ast.data.type).toBe('PATCH');
  });
});
