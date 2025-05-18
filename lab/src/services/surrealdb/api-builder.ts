// Barrel for the SurrealDB ODM query builder; re-exports the full public API.
export { as_, document, field, rel, relPath } from './api';
export type { LiveAction, LiveNotification } from './api';

export type { SurrealError } from './engine';
export {
  SurrealConnectionError,
  SurrealDecodeError,
  SurrealQueryError,
  SurrealRecordNotFoundError,
} from './engine';

export { compare } from './query/ast-helpers';
export { raw, fn, count, id, sql } from './query/primitives';
export { ExecutableQuery } from './query/executable';
export type {
  AnyDocumentDef,
  AnyExecutableQuery,
  ExtractQueryReturn,
} from './query/executable';
export { SelectBuilder } from './query/select';
export { CreateBuilder } from './query/create';
export { UpdateBuilder } from './query/update';
export { UpsertBuilder } from './query/upsert';
export { DeleteBuilder } from './query/delete';
export { InsertBuilder } from './query/insert';
export { RelateBuilder } from './query/relate';
export { TransactionBuilder } from './query/transaction';
export {
  DatabaseSchema,
  DocScope,
  SchemaDefinition,
  dbschema,
} from './query/schema';
export type { DbSchema } from './query/schema';
