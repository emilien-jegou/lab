// lab/src/modules/example/schema.ts
import { Schema } from 'effect';

import { dbschema, document } from '~/services/surrealdb/api-builder';

export const UserSignupSchema = Schema.Struct({
  id: Schema.String.annotations({
    title: 'User ID',
    description: 'The unique identifier (UUID) of the user to signup',
  }),
  email: Schema.String.annotations({
    description: 'The primary contact email',
  }),
}).annotations({
  description: 'Payload required for user onboarding',
});

export const EventSchema = Schema.Struct({
  id: Schema.String.annotations({
    title: 'Event ID',
    description: 'The unique identifier of the event record',
  }),
  name: Schema.String.annotations({
    title: 'Event Name',
    description: 'The event action or type',
  }),
  email: Schema.String.annotations({
    title: 'User Email',
    description: 'User email associated with the event',
  }),
  timestamp: Schema.String.annotations({
    title: 'Timestamp',
    description: 'ISO timestamp when the event was emitted',
  }),
}).annotations({
  description: 'System event log schema',
});

export const UserSignupDoc = document('user-signup', UserSignupSchema);
export const EventDoc = document('events', EventSchema);

export const DbSchemaLive = dbschema(UserSignupDoc, EventDoc);
export const ExampleDb = DbSchemaLive;
