// Example module wiring webhook and cron triggers with a dashboard view.
import { Effect, Layer } from 'effect';

import { defineModule } from '~/core/system/module';
import { bindTrigger, cron, webhook } from '~/core/triggers';
import { id } from '~/services/surrealdb/api-builder';
import { ExampleDashboardLayer } from './dashboard';
import {
  DBSchemaLive,
  EventDoc,
  UserSignupDoc,
  UserSignupSchema,
} from './schema';

export { DBSchemaLive as DbSchemaLive, EventDoc, UserSignupDoc, UserSignupSchema };

const ExampleLayerLive = Layer.mergeAll(
  // 1. Webhook trigger
  bindTrigger(
    webhook.post('/demo').json(UserSignupSchema).name('User Signup Webhook'),
    Effect.fn(function*(payload) {
      const db = yield* DBSchemaLive;

      // Idempotent user write
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

  // 2. 5-Second Cron Trigger
  bindTrigger(
    cron('example-5s-heartbeat', '*/5 * * * * *'),
    Effect.fn(function*() {
      const timestamp = new Date().toISOString();
      yield* Effect.logInfo(`[Cron] 5s pulse triggered at ${timestamp}`);

      const db = yield* DBSchemaLive;
      yield* db
        .doc('events')
        .create({
          id: `event_cron_${Date.now()}`,
          name: 'cron.heartbeat',
          email: 'system@cron.local',
          timestamp,
        })
        .toEffect()
        .pipe(
          Effect.catchAll((err) =>
            Effect.logWarning(`Failed to persist cron event: ${err.message}`),
          ),
        );
    }),
  ),
);

export const ExampleLive = defineModule(
  'example',
  Layer.mergeAll(ExampleLayerLive, ExampleDashboardLayer, DBSchemaLive),
);
