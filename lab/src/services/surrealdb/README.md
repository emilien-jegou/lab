# SurrealDB Effect ODM & Query Builder

An end-to-end type-safe, immutable Object-Document-Graph Mapper (ODM) and query builder for **SurrealDB**, powered by **Effect-TS**.

---

## Features

- **Strict Compile-Time Typing:** Field selection, deep nested paths (`details.bio`), aliases, ordering, and filters are validated against your schema. Invalid fields trigger compile errors.
- **Deep Type Inference:** Projection return types automatically narrow based on selected fields, relations, and aliases.
- **SurrealQL Compiler with Automatic Parameterization:** All values, arrays, nested structures, and record IDs are parameterized (`$p1`, `$p2`) through AST compilation, eliminating SQL injection.
- **Native Effect Integration:** Queries are fully executable as Effects or yieldable inside `Effect.gen` via generator iteration (`[Symbol.iterator]`).
- **Reactive Live Queries (`Effect.Stream`):** Execute real-time `LIVE SELECT` statements streamed via Effect's `Stream.Stream`, complete with schema decoding and automatic `KILL` finalization.
- **Graph & Relations:** Native support for SurrealDB graph traversal (`->wrote->post.*`) and edge creation (`RELATE`).
- **Atomic Transactions:** Fluent `BEGIN ... COMMIT` transactions with individual statement result decoding.
- **Automatic Runtime Validation:** Results decode through Effect's `@effect/schema`, surfacing tagged errors (`SurrealDecodeError`, `SurrealRecordNotFoundError`, `SurrealQueryError`).

---

## Table of Contents

1. [Schema Definition](#1-schema-definition)
2. [Connecting & Engine Setup](#2-connecting--engine-setup)
3. [Record IDs](#3-record-ids)
4. [SELECT Queries](#4-select-queries)
   - [Full Document Selection](#full-document-selection)
   - [Field Projections & Deep Keys](#field-projections--deep-keys)
   - [Aliases (`as_`)](#aliases-as_)
   - [Graph Traversal (`relPath`)](#graph-traversal-relpath)
   - [Modifiers (Limit, Order, Group By, Fetch, etc.)](#modifiers)
5. [WHERE Filters & Operators](#5-where-filters--operators)
   - [Comparison & Array Operators](#comparison--array-operators)
   - [Vector Search (`$knn`)](#vector-search-knn)
   - [Raw SQL & Expressions (`$raw`, `$expr`)](#raw-sql--expressions)
6. [CREATE Queries](#6-create-queries)
7. [INSERT Queries](#7-insert-queries)
8. [UPDATE & UPSERT Queries](#8-update--upsert-queries)
9. [DELETE Queries](#9-delete-queries)
10. [RELATE Queries (Graph Edges)](#10-relate-queries-graph-edges)
11. [Transactions](#11-transactions)
12. [Safe Raw SQL (`sql` Tag)](#12-safe-raw-sql-sql-tag)
13. [Effect Integration & Error Handling](#13-effect-integration--error-handling)
14. [Live Queries (`LIVE SELECT`)](#14-live-queries-live-select)

---

## 1. Schema Definition

Define your document structures using Effect's `Schema` and connect graph relationships using `document` and `rel`:

```typescript
import { Schema } from 'effect';
import { document, rel, dbschema } from './surrealdb/api-builder';

// 1. Define child document
export const TagDoc = document(
  'tag',
  Schema.Struct({
    label: Schema.String,
    category: Schema.String,
  })
);

// 2. Define document with relations
export const PostDoc = document(
  'post',
  Schema.Struct({
    title: Schema.String,
    content: Schema.String,
    published: Schema.Boolean,
    views: Schema.Number,
  }),
  [rel('tagged', TagDoc)] // post -[tagged]-> tag
);

// 3. Define top-level document
export const UserDoc = document(
  'user',
  Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    role: Schema.Literal('admin', 'member'),
    details: Schema.Struct({
      bio: Schema.String,
      age: Schema.Number,
    }),
  }),
  [rel('wrote', PostDoc)] // user -[wrote]-> post
);

// 4. Create the unified schema definition
export const AppDB = dbschema(UserDoc, PostDoc, TagDoc);
```

---

## 2. Connecting & Engine Setup

```typescript
import * as Effect from 'effect/Effect';
import { SurrealLive } from './surrealdb/engine';
import { AppDB } from './schema';

// Option A: As an Effect service
const program = Effect.gen(function* () {
  const db = yield* AppDB.asEffect();
  const users = yield* db.doc('user').select();
  return users;
});

// Provide SurrealLive layer and run
Effect.runPromise(program.pipe(Effect.provide(SurrealLive)));

// Option B: Direct connection with an engine instance
const db = AppDB.connect(myEngine);
```

---

## 3. Record IDs

Construct type-safe SurrealDB record IDs with the `id()` helper, or use string syntax (`'user:alice'`):

```typescript
import { id } from './surrealdb/api-builder';

// Strongly typed Record ID (table name is checked against schema)
const aliceId = id('user', 'alice');       // user:"alice"
const numericId = id('post', 42);          // post:42
const complexId = id('log', ['auth', 1]);  // log:["auth",1]

// Pass directly to doc scopes:
db.doc(aliceId).select();
db.doc('user:alice').select(); // Both target the specific record
```

---

## 4. SELECT Queries

### Full Document Selection
```typescript
// SELECT * FROM user; => Promise<User[]>
const allUsers = yield* db.doc('user').select();

// SELECT * FROM ONLY user:alice; => Promise<User> (fails with SurrealRecordNotFoundError if missing)
const alice = yield* db.doc(id('user', 'alice')).select().first();
```

### Field Projections & Deep Keys
Only valid keys and dot-notation nested paths compile. Projections automatically narrow the returned TypeScript type:

```typescript
// Return type inferred as: { readonly name: string; readonly email: string; }[]
const users = yield* db.doc('user').select('name', 'email');

// Deep nested dot-path! Inferred as: { readonly "details.bio": string; }[]
const bios = yield* db.doc('user').select('details.bio');

// @ts-expect-error - Compile Error: 'nonExistent' is not in UserDoc
db.doc('user').select('nonExistent');
```

### Aliases (`as_`)
```typescript
import { as_ } from './surrealdb/api-builder';

// Return type: { readonly contactEmail: string; }[]
const contacts = yield* db.doc('user').select(as_('email', 'contactEmail'));
```

### Graph Traversal (`relPath`)
```typescript
import { relPath } from './surrealdb/api-builder';

// Traverses user -> wrote -> post.*
// Return type automatically resolves to Post[] based on Schema relations!
const posts = yield* db.doc('user').select(relPath('->wrote->post.*'));
```

### Aggregations
```typescript
import { count, as_ } from './surrealdb/api-builder';

// Inferred as: { readonly count: number; }[]
const total = yield* db.doc('user').select(count());

// Inferred as: { readonly totalUsers: number; }[]
const totalAliased = yield* db.doc('user').select(as_(count(), 'totalUsers'));
```

### Modifiers
```typescript
const results = yield* db.doc('user')
  .select('name', 'role')
  .omit('details')
  .where({ role: 'admin' })
  .withIndex('idx_user_role')
  .groupBy('role')
  .orderBy({ field: 'name', direction: 'ASC', collate: true })
  .limit(20)
  .start(40)
  .timeout('5s')
  .explain('FULL');
```

---

## 5. WHERE Filters & Operators

### Comparison & Array Operators
Filters are type-checked against document fields:

```typescript
const filtered = yield* db.doc('user').select().where({
  role: 'admin',                        // role = "admin"
  'details.age': { $gte: 21, $lt: 65 },  // details.age >= 21 AND details.age < 65
  email: { $fuzzy: '@gmail.com' },      // email ~ "@gmail.com"
  name: { $in: ['Alice', 'Bob'] },      // name INSIDE ["Alice", "Bob"]
});
```

Chaining `.where()` calls merges them using `AND`:

```typescript
const q = db.doc('user').select()
  .where({ role: 'member' })
  .where({ 'details.age': { $gt: 18 } });
// Emits: WHERE (role = $p1 AND details.age > $p2)
```

### Logical Combinators (`$and`, `$or`, `$nullish`)
```typescript
const custom = yield* db.doc('user').select().where({
  $or: [
    { role: 'admin' },
    { $and: [{ role: 'member' }, { 'details.age': { $gte: 30 } }] },
  ],
  $nullish: ['details.bio', false],
});
```

### Vector Search (`$knn`)
Parameterizes nearest-neighbor queries without string manipulation:

```typescript
const knn = yield* db.doc('post').select().where({
  embedding: { $knn: [10, 'COSINE', [0.12, 0.45, 0.78]] },
});
// Emits: embedding <| 10, COSINE|> $p1
```

### Raw SQL & Expressions
```typescript
import { raw, compare } from './surrealdb/api-builder';

const advanced = yield* db.doc('user').select().where({
  $raw: raw`time::now() > ${new Date()}`,
  $expr: compare('details.age', '>=', 21),
});
```

---

## 6. CREATE Queries

Create single or multiple records with schema validation:

```typescript
// Single record creation (validated against User schema)
const newUser = yield* db.doc('user').create({
  name: 'Alice',
  email: 'alice@example.com',
  role: 'admin',
  details: { bio: 'Engineer', age: 28 },
});

// Bulk creation
const newUsers = yield* db.doc('user').create([
  { name: 'Bob', email: 'bob@example.com', role: 'member', details: { bio: '', age: 24 } },
  { name: 'Charlie', email: 'charlie@example.com', role: 'member', details: { bio: '', age: 31 } },
]);

// Custom return modes ('NONE', 'BEFORE', 'AFTER', 'DIFF', or projected fields)
yield* db.doc('user')
  .create({ name: 'Dan', email: 'dan@example.com', role: 'member', details: { bio: '', age: 22 } })
  .returns('DIFF');
```

---

## 7. INSERT Queries

SurrealDB's `INSERT` supports batch payloads, duplicate resolution, and relation tags:

```typescript
yield* db.doc('user')
  .insert([
    { name: 'Dave', email: 'dave@example.com', role: 'member', details: { bio: '', age: 30 } },
    { name: 'Eve', email: 'eve@example.com', role: 'member', details: { bio: '', age: 29 } },
  ])
  .ignore() // INSERT IGNORE INTO user ...
  .onDuplicate({ role: 'member' }) // ON DUPLICATE KEY UPDATE role = $p1
  .returns('AFTER');
```

---

## 8. UPDATE & UPSERT Queries

Mutations support `set`, `merge`, `unset`, `patch`, and `content`:

```typescript
// SET partial update
yield* db.doc(id('user', 'alice'))
  .update()
  .set({ role: 'admin' })
  .first();

// MERGE deep JSON patch
yield* db.doc('user')
  .update()
  .merge({ details: { bio: 'Senior Architect' } })
  .where({ role: 'admin' });

// UNSET fields
yield* db.doc('user')
  .update()
  .unset(['details.bio'])
  .where({ role: 'member' });

// UPSERT (Updates if exists, creates if missing)
const user = yield* db.doc(id('user', 'alice'))
  .upsert()
  .set({ name: 'Alice', role: 'admin' })
  .first();
```

---

## 9. DELETE Queries

```typescript
// Delete with filter
yield* db.doc('user')
  .remove()
  .where({ role: 'member', 'details.age': { $lt: 18 } });

// Delete and return deleted records (type-safe)
const deleted = yield* db.doc('user')
  .remove()
  .where({ email: 'inactive@example.com' })
  .returns('BEFORE'); // Returns User[]
```

---

## 10. RELATE Queries (Graph Edges)

Create edges between records with metadata:

```typescript
const relation = yield* db.doc(id('user', 'alice'))
  .relate('wrote')
  .to(id('post', 'hello-world'))
  .set({ publishedAt: new Date(), pinned: true })
  .first();
// Emits: RELATE ONLY type::thing($p1, $p2)->wrote->type::thing($p3, $p4) SET publishedAt = $p5, pinned = $p6;
```

---

## 11. Transactions

Execute atomic multi-statement operations. Unwrapping and decoding are handled automatically per query:

```typescript
const [updatedSender, updatedRecipient] = yield* db.transaction((tx) => [
  // Statement 1: Deduct balance
  tx.doc(id('account', 'sender'))
    .update()
    .set({ balance: 400 })
    .first(),

  // Statement 2: Credit recipient
  tx.doc(id('account', 'recipient'))
    .update()
    .set({ balance: 600 })
    .first(),
]);
```

If any statement in the transaction fails or aborts, the entire transaction rolls back and fails with `SurrealQueryError`.

---

## 12. Safe Raw SQL (`sql` Tag)

For custom SurrealQL statements with automated parameter binding:

```typescript
import { sql, id } from './surrealdb/api-builder';

interface ReportRow {
  department: string;
  total: number;
}

const minEmployees = 5;
const targetId = id('department', 'engineering');

// Values are parameterized as $p1, $p2 automatically
const query = sql<ReportRow>`
  SELECT department, count() AS total 
  FROM ${targetId} 
  WHERE active = true AND count > ${minEmployees} 
  GROUP BY department;
`;

const report = yield* query;
```

---

## 13. Effect Integration & Error Handling

All queries implement Effect's `[Symbol.iterator]`, allowing them to be yielded directly inside `Effect.gen`:

```typescript
import * as Effect from 'effect/Effect';
import { SurrealRecordNotFoundError, SurrealDecodeError, SurrealQueryError } from './surrealdb/api-builder';

const program = Effect.gen(function* () {
  const user = yield* db.doc(id('user', 'alice')).select().first();
  return user;
}).pipe(
  Effect.catchTags({
    SurrealRecordNotFoundError: (err) =>
      Effect.logWarning(`Target record not found: ${JSON.stringify(err.target)}`),
    SurrealDecodeError: (err) =>
      Effect.logError(`Schema validation failed: ${err.message}`),
    SurrealQueryError: (err) =>
      Effect.logError(`Query error in [${err.sql}]: ${err.message}`),
  })
);
```

---

## 14. Live Queries (`LIVE SELECT`)

SurrealDB's real-time queries are supported directly through `select().live()`. This compiles into a native SurrealQL `LIVE SELECT` statement and returns an **`Effect.Stream`**.

### Syntax: `.select().live()`
Chaining `.live()` off `.select()` gives you all the power of the select builder—including field projections and type-safe `WHERE` filters:

```typescript
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';
import type { LiveNotification } from './surrealdb/api-builder';

// 1. Stream all live changes for a table
const userStream = db.doc('user').select().live();

// 2. Stream with field projection and filtered WHERE criteria
const adminStream = db.doc('user')
  .select('name', 'email')
  .where({ role: 'admin' })
  .live();
// Emits: LIVE SELECT name, email FROM user WHERE role = $p1;

// 3. Stream JSON diffs using the diff option
const diffStream = db.doc('user')
  .select()
  .live({ diff: true });
// Emits: LIVE SELECT DIFF FROM user;
```

### Consuming Live Streams

Each element in the stream is typed as `LiveNotification<T>`:

```typescript
export interface LiveNotification<T> {
  readonly action: 'CREATE' | 'UPDATE' | 'DELETE';
  readonly result: T;
  readonly queryId?: string;
}
```

Every emitted notification's `result` is automatically validated against your `@effect/schema` at runtime. If a payload violates the schema, the stream halts with `SurrealDecodeError`.

```typescript
const liveProgram = Effect.gen(function* () {
  const stream = db.doc('user')
    .select('name', 'email')
    .where({ role: 'admin' })
    .live();

  yield* stream.pipe(
    Stream.runForEach((notification) =>
      Effect.logInfo(
        `[${notification.action}] User: ${notification.result.name} (${notification.result.email})`
      )
    )
  );
});
```

### Automatic Resource Cleanup (`KILL`)

Live streams use Effect's structured concurrency (`Stream.asyncScoped`). When the stream ends, is interrupted, or when the parent scope closes (for instance, via `Stream.take(n)`), the ODM registers a finalizer that automatically calls `KILL <query-uuid>;` on SurrealDB to prevent orphaned subscriptions on the server.

```typescript
// Take the first 5 events and then cleanly KILL the subscription on SurrealDB:
const firstFive = yield* db.doc('user')
  .select()
  .live()
  .pipe(
    Stream.take(5),
    Stream.runCollect
  );
```
