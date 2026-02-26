// lab/src/services/surrealdb/tests/queries/edge-cases.test.ts
import { Schema } from 'effect';
import * as Effect from 'effect/Effect';
import { describe, it, expect } from 'vitest';

import { document } from '../../api';
import { dbschema, compare, field } from '../../api-builder';
import { StatementBuilder } from '../../statement-builder';
import { createMockEngine } from '../test-utils';

const ItemDoc = document(
  'item',
  Schema.Struct({
    title: Schema.String,
    price: Schema.Number,
  }),
);

describe('API Edge Cases & Holes', () => {
  it('BUG FIX: compare() should treat left operand as an identifier, not a bound string literal', () => {
    const db = dbschema(ItemDoc).connect(createMockEngine());
    const query = db.doc('item').select().where({
      $expr: compare('price', '>=', 100),
    });

    const { sql, bindings } = new StatementBuilder().compile(query.getAst());

    // Fails if 'price' was bound as a literal: "SELECT * FROM item WHERE $p1 >= $p2;"
    expect(sql).toBe('SELECT * FROM item WHERE price >= $p1;');
    expect(bindings).toEqual({ p1: 100 });
  });

  it('BUG FIX: create() single record without .first() should decode array result without throwing', () => {
    const mockEngine = createMockEngine([
      { title: 'Keyboard', price: 120 }, // SurrealDB returns 1-element array
    ]);

    const db = dbschema(ItemDoc).connect(mockEngine);

    // Should decode into an array of items without SurrealDecodeError
    const result = Effect.runSync(
      db.doc('item').create({ title: 'Keyboard', price: 120 }).toEffect(),
    );

    expect(result).toEqual([{ title: 'Keyboard', price: 120 }]);
  });

  it('compiles full SQL for UPDATE with PATCH mode', () => {
    const db = dbschema(ItemDoc).connect(createMockEngine());
    const query = db
      .doc('item')
      .update()
      .patch([{ op: 'replace', path: '/price', value: 99 }]);

    const { sql, bindings } = new StatementBuilder().compile(query.getAst());
    expect(sql).toBe('UPDATE item PATCH $p1 RETURN AFTER;');
    expect(bindings.p1).toEqual([{ op: 'replace', path: '/price', value: 99 }]);
  });

  it('compiles full SQL for RELATE query with target and edge data', () => {
    const db = dbschema(ItemDoc).connect(createMockEngine());
    const query = db
      .doc('item:1')
      .relate('bought')
      .to('user:alice')
      .set({ quantity: 2 });

    const { sql, bindings } = new StatementBuilder().compile(query.getAst());
    expect(sql).toBe(
      'RELATE type::record($p1, $p2)->bought->type::record($p3, $p4) SET quantity = $p5;',
    );
    expect(bindings.p1).toBe('item');
    expect(bindings.p2).toBe(1); // Coerced to numeric ID 1 instead of string "1"
    expect(bindings.p3).toBe('user');
    expect(bindings.p4).toBe('alice');
    expect(bindings.p5).toBe(2);
  });
});
