import { Effect, Layer } from 'effect';

import { defineModule } from '~/core/system/module';
import { webhook } from '~/core/triggers';
import { id } from '~/services/surrealdb/api-builder';
import { ExampleDashboardLayer } from './dashboard';
import {
  DbSchemaLive,
  EventDoc,
  ExampleDb,
  UserSignupDoc,
  UserSignupSchema,
} from './schema';

export { DbSchemaLive, EventDoc, ExampleDb, UserSignupDoc, UserSignupSchema };

const ExampleLayerLive = Layer.mergeAll(
  webhook
    .post('/demo')
    .json(UserSignupSchema)
    .name('User Signup Webhook')
    .bind(
      Effect.fn(function*(payload) {
        const db = yield* ExampleDb;

        // Idempotent user write: updates if already exists instead of crashing with duplicate key error
        yield* db
          .doc('user-signup')
          .create({ id: payload.id, email: payload.email })
          .toEffect()
          .pipe(
            Effect.catchAll(() =>
              db
                .doc(id('user-signup', payload.id))
                .update()
                .set({ email: payload.email })
                .toEffect(),
            ),
          );
        yield* Effect.logInfo(`User saved successfully: ${payload.id}`);

        const event = yield* db.doc('events').create({
          id: `event_${Date.now()}_${payload.id}`,
          name: 'user.signup',
          email: payload.email,
          timestamp: new Date().toISOString(),
        }).toEffect();
        yield* Effect.logInfo(`Emitted event: ${JSON.stringify(event)}`);

        const allEvents = yield* db.doc('events').select().toEffect();
        yield* Effect.logInfo(`Retrieved Events Count: ${allEvents.length}`);

        yield* Effect.log(`[Execution] Provisioning resources for ${payload.id}...`);
      }),
    ),
);

export const ExampleLive = defineModule(
  'example',
  Layer.mergeAll(ExampleLayerLive, ExampleDashboardLayer, DbSchemaLive),
);

