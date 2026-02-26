// lab/src/services/surrealdb/tests/queries/query-fixes.test.ts
import { Schema } from 'effect';
import * as Effect from 'effect/Effect';
import { describe, it, expect } from 'vitest';

import { document } from '../../api';
import { dbschema, id } from '../../api-builder';
import { SurrealEngine, unwrapSurrealResult, unwrapSurrealTransactionResults } from '../../engine';
import { StatementBuilder } from '../../statement-builder';
import { createMockEngine } from '../test-utils';

const ProductDoc = document(
  'product',
  Schema.Struct({
    title: Schema.String,
    price: Schema.Number,
  }),
);

describe('Query Engine & Builder Fixes', () => {
  it('automatically defaults to RETURN AFTER when no returns() is specified', () => {
    const db = dbschema(ProductDoc).connect(createMockEngine());
    const query = db
      .doc(id('product', 'laptop'))
      .upsert()
      .set({ price: 999 });

    const { sql, bindings } = new StatementBuilder().compile(query.getAst());

    expect(sql).toBe('UPSERT type::record($p1, $p2) SET price = $p3 RETURN AFTER;');
    expect(bindings).toEqual({
      p1: 'product',
      p2: 'laptop',
      p3: 999,
    });
  });
});

describe('2. Insert Schema Decoding', () => {
  it('successfully decodes inserted records against the document schema', () => {
    const rawInserted = [{ title: 'Keyboard', price: 120 }];
    const engine = createMockEngine(rawInserted);
    const db = dbschema(ProductDoc).connect(engine);

    const result = Effect.runSync(
      db
        .doc('product')
        .insert({ title: 'Keyboard', price: 120 })
        .returns('AFTER')
        .toEffect(),
    );

    expect(result).toEqual([{ title: 'Keyboard', price: 120 }]);
  });

  it('fails with SurrealDecodeError when inserted payload violates schema', () => {
    // Mock engine returns invalid type for price (string instead of number)
    const invalidInserted = [{ title: 'Keyboard', price: 'not-a-number' }];
    const engine = createMockEngine(invalidInserted);
    const db = dbschema(ProductDoc).connect(engine);

    const exit = Effect.runSyncExit(
      db
        .doc('product')
        .insert({ title: 'Keyboard', price: 120 })
        .returns('AFTER')
        .toEffect(),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = (exit.cause as any).error;
      expect(error._tag).toBe('SurrealDecodeError');
      expect(error.message).toContain('Failed to decode inserted record against schema "product"');
    }
  });
});

describe('3. Undefined Values in WHERE Clause', () => {
  it('skips undefined properties and avoids creating unbound parameters', () => {
    const db = dbschema(ProductDoc).connect(createMockEngine());

    // Query includes an optional property set to undefined
    const query = db.doc('product').select().where({
      title: 'Monitor',
      price: undefined,
    });

    const { sql, bindings } = new StatementBuilder().compile(query.getAst());

    // Only title should be compiled; price: undefined must not generate an unbound $p2
    expect(sql).toBe('SELECT * FROM product WHERE title = $p1;');
    expect(bindings).toEqual({ p1: 'Monitor' });
  });
});

describe('4. Nested Dot-Path Identifier Escaping', () => {
  it('escapes individual path segments for subfields containing dashes', () => {
    const ComplexDoc = document('complex', Schema.Any);
    const db = dbschema(ComplexDoc).connect(createMockEngine());

    const query = db.doc('complex').select('meta.user-id', 'settings.font-size');
    const { sql } = new StatementBuilder().compile(query.getAst());

    // Each subfield with a dash should be backticked individually, not the entire string
    expect(sql).toBe('SELECT meta.`user-id`, settings.`font-size` FROM complex;');
  });
});

describe('5. SurrealDB v2 Error Object Detection', () => {
  it('unwraps v2 RPC style error objects { error: { message: ... } } in queries', () => {
    const v2ErrorResponse = [
      {
        error: {
          code: -32000,
          message: 'Database connection closed by remote host',
        },
      },
    ];

    expect(() => unwrapSurrealResult(v2ErrorResponse)).toThrow(
      'Database connection closed by remote host',
    );
  });

  it('unwraps v2 RPC style error objects inside transactions', () => {
    const v2TxErrorResponse = [
      { status: 'OK', result: null },
      { error: { code: -32001, message: 'Transaction rolled back' } },
      { status: 'OK', result: null },
    ];

    expect(() => unwrapSurrealTransactionResults(v2TxErrorResponse, 1)).toThrow(
      'Transaction rolled back',
    );
  });
});
