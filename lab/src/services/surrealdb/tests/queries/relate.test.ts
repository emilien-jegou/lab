import { Schema } from 'effect';
import { describe, it, expect } from 'vitest';

import { document, rel } from '../../api';
import { dbschema, id } from '../../api-builder';
import type { RelateStatement } from '../../ast';
import { mockEngine, useAstCapture } from '../test-utils';

const TagDoc = document('tag', Schema.Any);
const PostDoc = document('post', Schema.Any, [rel('tagged', TagDoc)]);
const UserDoc = document('user', Schema.Any, [rel('wrote', PostDoc)]);

const db = dbschema(TagDoc, PostDoc, UserDoc).connect(mockEngine);

describe('RELATE Query Builder', () => {
  const { capture } = useAstCapture();

  it('builds a RELATE AST for user -[wrote]-> post with SET data', () => {
    const qEff = db
      .doc(id('user', 'alice'))
      .relate('wrote')
      .to(id('post', 'hello'))
      .set({ draft: false })
      .returns('AFTER');

    const ast = capture<RelateStatement>(qEff);
    expect(ast.type).toBe('RELATE');
    expect(ast.from).toEqual({ type: 'RECORD_ID', table: 'user', id: 'alice' });
    expect(ast.edge).toEqual({ type: 'IDENTIFIER', value: 'wrote' });
    expect(ast.data?.type).toBe('SET');
    expect(ast.return).toEqual({ type: 'KEYWORD', value: 'AFTER' });
  });
});
