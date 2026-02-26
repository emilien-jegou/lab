import { Schema } from 'effect';
import * as Effect from 'effect/Effect';
import { describe, it, expect } from 'vitest';

import { document, rel } from '../../api';
import { dbschema, as_, relPath } from '../../api-builder';
import type { SelectStatement } from '../../ast';
import { mockEngine, createMockEngine, useAstCapture } from '../test-utils';

const TagDoc = document('tag', Schema.Struct({ label: Schema.String, category: Schema.String }));
const PostDoc = document(
  'post',
  Schema.Struct({
    title: Schema.String,
    content: Schema.String,
    published: Schema.Boolean,
    meta: Schema.Struct({ views: Schema.Number, likes: Schema.Number }),
  }),
  [rel('tagged', TagDoc)],
);
const UserDoc = document(
  'user',
  Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    details: Schema.Struct({ bio: Schema.String, age: Schema.Number }),
  }),
  [rel('wrote', PostDoc)],
);
const ArticleDoc = document('article', Schema.Any);
const ComplexDoc = document('complex', Schema.Any);

const db = dbschema(UserDoc, ArticleDoc, ComplexDoc, PostDoc, TagDoc).connect(mockEngine);

describe('SELECT Query Builder', () => {
  const { capture } = useAstCapture();

  it('guarantees query immutability when chaining modifiers', () => {
    const base = db.doc('article').select('title');
    const q10 = base.limit(10);
    const q20 = base.limit(20);

    const ast10 = capture<SelectStatement>(q10);
    const ast20 = capture<SelectStatement>(q20);

    expect(ast10.limit).toBe(10);
    expect(ast20.limit).toBe(20);
  });

  describe('Relations and Aliases', () => {
    it('emits a graph traversal path as a GRAPH_PATH node', () => {
      const qEff = db.doc('user').select(relPath('->wrote->post.*'));
      expect(capture<SelectStatement>(qEff).fields).toEqual([
        { type: 'GRAPH_PATH', path: '->wrote->post.*' },
      ]);
    });

    it('emits ALIAS node for as_() calls', () => {
      const qEff = db.doc('user').select(as_('email', 'contact'));
      expect(capture<SelectStatement>(qEff).fields).toEqual([
        {
          type: 'ALIAS',
          expr: { type: 'IDENTIFIER', value: 'email' },
          alias: 'contact',
        },
      ]);
    });
  });

  describe('Schema Validation at Runtime', () => {
    it('fails with SurrealDecodeError when schema validation fails', () => {
      const failingEngine = createMockEngine([{ invalidField: 123 }]);
      const failingDb = dbschema(TagDoc).connect(failingEngine);

      const result = Effect.runSyncExit(failingDb.doc('tag').select().toEffect());
      expect(result._tag).toBe('Failure');
    });
  });

  describe('Uniform Array Return Shape', () => {
    it('always returns an array for select() even when exactly one record matches', () => {
      const singleRecordEngine = createMockEngine([{ label: 'tech', category: 'news' }]);
      const testDb = dbschema(TagDoc).connect(singleRecordEngine);

      const result = Effect.runSync(testDb.doc('tag').select().toEffect());
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ label: 'tech', category: 'news' });
    });

    it('returns a single object when first() is used on one record', () => {
      const singleRecordEngine = createMockEngine([{ label: 'tech', category: 'news' }]);
      const testDb = dbschema(TagDoc).connect(singleRecordEngine);

      const result = Effect.runSync(testDb.doc('tag').select().first().toEffect());
      expect(Array.isArray(result)).toBe(false);
      expect(result).toEqual({ label: 'tech', category: 'news' });
    });
  });

  describe('Strict Compile-Time Field Typing', () => {
    it('allows valid direct and deep fields and infers their exact types', () => {
      // 1. Direct field selection
      const q1 = db.doc('user').select('name', 'email');
      type R1 = Effect.Effect.Success<ReturnType<typeof q1.toEffect>>;
      const _check1: R1 = [{ name: 'Alice', email: 'alice@test.com' }];

      // 2. Nested dot-notation field selection
      const q2 = db.doc('user').select('details.bio');
      type R2 = Effect.Effect.Success<ReturnType<typeof q2.toEffect>>;
      const _check2: R2 = [{ 'details.bio': 'Developer' }];

      // 3. Alias selection
      const q3 = db.doc('user').select(as_('email', 'contact'));
      type R3 = Effect.Effect.Success<ReturnType<typeof q3.toEffect>>;
      const _check3: R3 = [{ contact: 'alice@test.com' }];

      expect(_check1).toBeDefined();
      expect(_check2).toBeDefined();
      expect(_check3).toBeDefined();
    });

    it('rejects invalid fields at compile-time', () => {
      // @ts-expect-error - 'notAField' does not exist in UserDoc schema
      db.doc('user').select('notAField');

      // @ts-expect-error - 'invalidField' does not exist in UserDoc schema for as_()
      db.doc('user').select(as_('invalidField', 'alias'));

      // @ts-expect-error - 'fakeField' does not exist in UserDoc schema for where()
      db.doc('user').select().where({ fakeField: 123 });

      // @ts-expect-error - 'fakeField' does not exist in UserDoc schema for orderBy()
      db.doc('user').select().orderBy({ field: 'fakeField' });
    });
  });
});
