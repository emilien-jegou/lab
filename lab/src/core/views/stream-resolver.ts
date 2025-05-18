// View-aware SSE resolver: bridges view streams and broker topics without HTTP.
import { Effect, Layer, Stream } from 'effect';

import { MessageBroker } from '../system/broker';
import { SseStreamResolver } from '../system/sse';
import { ViewRegistry } from './registry';

export const ViewSseStreamResolverLive: Layer.Layer<
  SseStreamResolver,
  never,
  MessageBroker | ViewRegistry
> = Layer.effect(
  SseStreamResolver,
  Effect.gen(function*() {
    const broker = yield* MessageBroker;
    const viewRegistry = yield* ViewRegistry;

    const resolveViewStream = (viewId: string, streamId: string) =>
      Stream.unwrap(
        Effect.gen(function*() {
          const viewOpt = yield* viewRegistry.get(viewId);
          if (viewOpt._tag === 'None') return Stream.empty;
          const ref = viewOpt.value.streams.get(streamId);
          if (!ref) return Stream.empty;
          return ref.stream.pipe(
            Stream.provideContext(viewOpt.value.context),
            Stream.catchAll(() => Stream.empty),
          );
        }),
      );

    return SseStreamResolver.of({
      resolve: (eventType) => {
        if (eventType.startsWith('view:')) {
          const [, viewId, streamId] = eventType.split(':');
          if (!viewId || !streamId) return Stream.empty;
          return resolveViewStream(viewId, streamId);
        }
        return broker.subscribe(eventType).pipe(Stream.catchAll(() => Stream.empty));
      },
    });
  }),
);
