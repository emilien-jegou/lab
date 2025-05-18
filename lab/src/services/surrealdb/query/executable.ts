// Base ExecutableQuery class plus shared document/target helper types.
import type { Schema } from 'effect';
import * as Effect from 'effect/Effect';
import { pipeArguments } from 'effect/Pipeable';

import type { DocumentDef, ExtractDocType, SurrealID } from '../api';
import type { StatementNode } from '../ast';
import type { SurrealError } from '../engine';
import { normalizeValue, SurrealEngine, SurrealQueryError } from '../engine';
import { StatementBuilder } from '../statement-builder';

export type AnyDocumentDef = DocumentDef<
  string,
  Schema.Schema<any, any, never>,
  readonly any[]
>;

export type ExtractTableName<S extends string> = S extends `${infer Table}:${string}` ? Table : S;

export type ResolveTarget<Docs extends readonly DocumentDef<any, any, any>[], T> = T extends string
  ? Extract<Docs[number], { name: ExtractTableName<T> }>
  : T extends SurrealID<infer N>
  ? Extract<Docs[number], { name: N }>
  : AnyDocumentDef;

export type Doc<Docs extends readonly DocumentDef<any, any, any>[], T> = ExtractDocType<
  ResolveTarget<Docs, T>
>;

export abstract class ExecutableQuery<A, E = SurrealError> {
  constructor(protected engine: SurrealEngine) { }

  abstract toEffect(): Effect.Effect<A, E, never>;
  abstract getAst(): StatementNode;

  decodeResult(rawResult: unknown): Effect.Effect<A, SurrealError, never> {
    return Effect.succeed(normalizeValue(rawResult) as A);
  }

  [Symbol.iterator]() {
    return this.toEffect()[Symbol.iterator]();
  }

  pipe(...args: any[]) {
    return pipeArguments(this.toEffect(), args as any);
  }

  protected executeAst(ast: any): Effect.Effect<A, SurrealQueryError, never> {
    return Effect.suspend(() => {
      const { sql, bindings } = new StatementBuilder().compile(ast);
      return this.engine.query<unknown>(sql, bindings).pipe(
        Effect.map((res) => normalizeValue(res) as A),
      );
    });
  }
}

export type AnyExecutableQuery = ExecutableQuery<any, SurrealError>;
export type ExtractQueryReturn<Q> = Q extends ExecutableQuery<infer R, any> ? R : never;
