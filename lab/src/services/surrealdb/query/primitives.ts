// Standalone ODM primitives: raw, fn, count, id, and the sql tag.
import * as Effect from 'effect/Effect';

import type { OdmValue, RawSQL, SurrealID } from '../api';
import { Ast } from '../ast-builder';
import { normalizeValue, SurrealEngine } from '../engine';
import { StatementBuilder } from '../statement-builder';
import { toAstValue } from './ast-helpers';

export const raw = (strings: TemplateStringsArray, ...values: unknown[]): RawSQL => ({
  _tag: 'RawSQL',
  strings,
  values,
});
export const fn = <N extends string, T = unknown>(name: N, args: unknown[] = []): OdmValue<T, N> => ({
  _tag: 'OdmValue',
  ast: Ast.val.func(name, args.map(toAstValue)),
});
export const count = (): OdmValue<number, 'count'> => fn('count') as OdmValue<number, 'count'>;
export const id = <Tb extends string>(
  table: Tb | { name: Tb },
  value: string | number | readonly unknown[] | object,
): SurrealID<Tb> => {
  const tableName = typeof table === 'string' ? table : table.name;
  return {
    _tag: 'SurrealID',
    table: tableName,
    value,
    toString: () =>
      `${tableName}:${Array.isArray(value) ? `[${value.map((v) => JSON.stringify(v)).join(',')}]` : JSON.stringify(value)}`,
  };
};

export const sql = <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => {
  return Effect.suspend(() => {
    const { sql: compiledSql, bindings } = new StatementBuilder().compile({
      type: 'RAW',
      strings,
      values,
    });
    return Effect.flatMap(SurrealEngine, (engine) =>
      engine.query<unknown>(compiledSql, bindings).pipe(
        Effect.map((rawResult) => normalizeValue(rawResult) as T[]),
      ),
    );
  });
};
