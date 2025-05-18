## Valkey integration

Define vaults anywhere (e.g. in your module or service definitions):

```typescript
import { Duration, Effect, Option, Schema } from "effect";
import { valkeyDefine } from "../../services/valkey";

// 1. Define the schema & vault
export const SessionSchema = Schema.Struct({
  userId: Schema.String,
  roles: Schema.Array(Schema.String),
  lastActive: Schema.DateFromString,
});

export const SessionKV = valkeyDefine("sessions", SessionSchema, {
  defaultTtl: "30 minutes",
});
```

Yield each vault directly inside your service:

```typescript
import { SessionKV } from "./sessions";

export const handleAuth = Effect.gen(function* () {
  // Directly yield the vault definition!
  const sessions = yield* SessionKV;

  // 1. SET with schema validation & default/custom TTL
  yield* sessions.set("token_abc123", {
    userId: "usr_42",
    roles: ["admin", "developer"],
    lastActive: new Date(),
  }, { ttl: Duration.hours(2) });

  // 2. GET (returns Option.Option<Session>)
  const maybeSession = yield* sessions.get("token_abc123");
  if (Option.isSome(maybeSession)) {
    const session = maybeSession.value; // Typed correctly!
    console.log(session.userId, session.lastActive.toISOString());
  }

  // 3. GET OR FAIL (fails with ValkeyKeyNotFoundError if missing)
  const session = yield* sessions.getOrFail("token_abc123");

  // 4. UPDATE (in-place typed update)
  yield* sessions.update("token_abc123", (curr) => ({
    ...curr,
    lastActive: new Date(),
  }));

  // 5. EXISTS & DEL
  const exists = yield* sessions.exists("token_abc123");
  yield* sessions.del("token_abc123");
});
```
