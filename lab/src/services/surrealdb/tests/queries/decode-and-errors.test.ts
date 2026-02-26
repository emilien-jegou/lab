import { Schema } from 'effect';
import * as Effect from 'effect/Effect';
import { describe, it, expect } from 'vitest';

import { document } from '../../api';
import { dbschema } from '../../api-builder';
import { SurrealEngine, SurrealRecordNotFoundError } from '../../engine';

const PersonDoc = document(
  'person',
  Schema.Struct({
    name: Schema.String,
    active: Schema.Boolean,
  }),
);

describe('Schema Decoding and Record Not Found Bugs', () => {
  it('correctly decodes array of updated records on multi-record update', () => {
    const mockData = [
      { name: 'Alice', active: true },
      { name: 'Bob', active: false },
    ];
    const engine = SurrealEngine.of({
      query: () => Effect.succeed(mockData as any),
      queryRaw: () => Effect.succeed([mockData]),
    });
    const db = dbschema(PersonDoc).connect(engine);

    // Multi-record update without .first() must decode against Schema.Array(PersonDoc.schema)
    const result = Effect.runSync(db.doc('person').update().set({ active: true }).toEffect());
    expect(result).toEqual(mockData);
  });

  it('fails with SurrealRecordNotFoundError when .first() is called on empty select with projection', () => {
    const engine = SurrealEngine.of({
      query: () => Effect.succeed(null as any),
      queryRaw: () => Effect.succeed([]),
    });
    const db = dbschema(PersonDoc).connect(engine);

    const exit = Effect.runSyncExit(db.doc('person').select('name').first().toEffect());
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      expect((exit.cause as any).error._tag).toBe('SurrealRecordNotFoundError');
    }
  });

  it('fails with SurrealQueryError on relate without to() inside Effect channel', () => {
    const engine = SurrealEngine.of({
      query: () => Effect.succeed([] as any),
      queryRaw: () => Effect.succeed([]),
    });
    const db = dbschema(PersonDoc).connect(engine);

    const q = db.doc('person').relate('friend');
    const exit = Effect.runSyncExit(q.toEffect());
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      expect((exit.cause as any).error._tag).toBe('SurrealQueryError');
    }
  });

  it('rejects empty .set({}) with a helpful error', () => {
    const engine = SurrealEngine.of({
      query: () => Effect.succeed([] as any),
      queryRaw: () => Effect.succeed([]),
    });
    const db = dbschema(PersonDoc).connect(engine);

    const exit = Effect.runSyncExit(db.doc('person').update().set({} as any).toEffect());
    expect(exit._tag).toBe('Failure');
  });
});
