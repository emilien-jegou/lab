import { Schema } from 'effect';
import { describe, it, expect } from 'vitest';

import { document } from '../../api';
import { dbschema, raw, compare } from '../../api-builder';
import type { SelectStatement } from '../../ast';
import { StatementBuilder } from '../../statement-builder';
import { mockEngine, useAstCapture } from '../test-utils';

const UserDoc = document(
  'user',
  Schema.Struct({
    name: Schema.String,
    age: Schema.Number,
    tags: Schema.Array(Schema.String),
    meta: Schema.Struct({ views: Schema.Number }),
    embedding: Schema.Array(Schema.Number),
  }),
);
const db = dbschema(UserDoc).connect(mockEngine);

describe('WHERE Operator Bug Fixes & Coverage', () => {
  const { capture } = useAstCapture();

  it('preserves $raw clauses in where()', () => {
    const rawCond = raw`age > ${18}`;
    const ast = capture<SelectStatement>(db.doc('user').select().where({ $raw: rawCond }));
    expect(ast.where).toEqual({
      type: 'RAW_CONDITION',
      strings: rawCond.strings,
      values: rawCond.values,
    });
  });

  it('preserves $expr conditions in where()', () => {
    const exprCond = compare('age', '>=', 21);
    const ast = capture<SelectStatement>(db.doc('user').select().where({ $expr: exprCond }));
    expect(ast.where).toEqual({
      type: 'COMPARISON',
      left: { type: 'IDENTIFIER', value: 'age' },
      operator: '>=',
      right: { type: 'LITERAL', value: 21 },
    });
  });

  // Replace the $knn test in lab/src/services/surrealdb/tests/queries/where-operators.test.ts
  it('correctly compiles $knn with target parameterization without [object Object]', () => {
    const query = db
      .doc('user')
      .select()
      .where({ embedding: { $knn: [10, 'COSINE', [0.1, 0.2]] } });

    const ast = query.getAst();
    const compiled = new StatementBuilder().compile(ast);

    expect(compiled.sql).toContain('<| 10, COSINE|> $p1');
    expect(compiled.sql).not.toContain('[object Object]');
    expect(compiled.bindings.p1).toEqual([0.1, 0.2]);
  });

  it('does not drop nested object criteria erroneously treated as operators', () => {
    const ast = capture<SelectStatement>(
      db.doc('user').select().where({ meta: { views: 100 } }),
    );

    expect(ast.where).toEqual({
      type: 'COMPARISON',
      left: { type: 'IDENTIFIER', value: 'meta' },
      operator: '=',
      right: { type: 'LITERAL', value: { views: 100 } },
    });
  });

  it('handles standard comparison operators in where()', () => {
    const ast = capture<SelectStatement>(
      db
        .doc('user')
        .select()
        .where({
          age: { $gt: 18, $lte: 65 },
          tags: { $contains: 'admin' },
        }),
    );

    expect(ast.where?.type).toBe('LOGICAL');
    if (ast.where?.type === 'LOGICAL') {
      expect(ast.where.operands.length).toBe(3);
    }
  });
});
