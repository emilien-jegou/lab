// lab/src/services/surrealdb/tests/queries/sql-raw.test.ts
import * as Effect from 'effect/Effect';
import { describe, it, expect } from 'vitest';

import { sql, id } from '../../api-builder';
import { SurrealEngine } from '../../engine';

describe('sql Template Tag', () => {
  it('parameterizes interpolated literals and record IDs safely', () => {
    let capturedSql = '';
    let capturedBindings: Record<string, unknown> = {};

    const engine = SurrealEngine.of({
      query: <T>(s: string, b: Record<string, unknown>): Effect.Effect<T, never, never> => {
        capturedSql = s;
        capturedBindings = b;
        return Effect.succeed<T>([] as unknown as T);
      },
      queryRaw: () => Effect.succeed([]),
    });

    const query = sql`SELECT * FROM ${id('user', 'alice')} WHERE age > ${30} AND name = ${'Alice'};`;

    Effect.runSync(Effect.provideService(query, SurrealEngine, engine));

    expect(capturedSql).toBe(
      'SELECT * FROM type::thing($p1, $p2) WHERE age > $p3 AND name = $p4;',
    );
    expect(capturedBindings).toEqual({
      p1: 'user',
      p2: 'alice',
      p3: 30,
      p4: 'Alice',
    });
  });
});
