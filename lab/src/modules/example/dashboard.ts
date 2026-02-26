// oxlint-disable require-yield
import { Effect, Stream } from 'effect';

import { Live, V, view } from '~/core/views';
import { ExampleDb } from './schema';

export const ExampleDashboardLayer = view({
  id: 'example-dashboard',
  name: 'Example Dashboard',
  description: 'An example dashboard view',
  tags: [],
})
  .dashboard()
  .show(
    Effect.gen(function*() {
      // 1. Live stats query from SurrealDB
      const stats = Live.query(
        Effect.gen(function*() {
          const db = yield* ExampleDb;
          const events = yield* db.doc('events').select();
          return {
            total: events.length,
            active: events.length,
          };
        }).pipe(
          Effect.catchAll(() => Effect.succeed({ total: 0, active: 0 })),
        ),
      );

      // 2. Fetch all events for data table
      const tableData = Live.query(
        Effect.gen(function*() {
          const db = yield* ExampleDb;
          return yield* db.doc('events').select();
        }).pipe(
          Effect.catchAll(() => Effect.succeed([])),
        ),
      );

      // 3. SurrealDB LIVE SELECT reactive stream
      const liveTicker = Live.stream(
        Stream.unwrap(
          Effect.gen(function*() {
            const db = yield* ExampleDb;
            const liveStream = db
              .doc('events')
              .select()
              .live()
              .pipe(
                Stream.map((notification) => ({
                  timestamp: Date.now(),
                  user: `${notification.action}: ${notification.result.name} (${notification.result.email})`,
                })),
              );

            return Stream.make({
              timestamp: Date.now(),
              user: 'Connected to SurrealDB live stream',
            }).pipe(Stream.concat(liveStream));
          }),
        ).pipe(
          Stream.catchAll((err) =>
            Stream.make({
              timestamp: Date.now(),
              user: `Stream error: ${String(err)}`,
            }),
          ),
        ),
      );

      return [
        V.row([
          V.stat({ label: 'Total Events', value: stats.map((s) => s.total) }),
          V.stat({ label: 'Active Events', value: stats.map((s) => s.active) }),
          V.stat({ label: 'Live Stream', value: liveTicker }),

          V.button(
            'Sync Now',
            Effect.gen(function*() {
              yield* Effect.logInfo('Running hard resync via button click...');
              return [stats.refresh(), tableData.refresh()];
            }),
          ),
        ]),
        V.divider(),
        V.table(tableData),
      ];
    }),
  );
