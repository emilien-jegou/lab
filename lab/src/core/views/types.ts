import type { Context, Effect } from 'effect';
import type { LiveQueryRef, LiveStreamRef } from './live';

export interface ViewMeta {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly type: string;
  readonly moduleId?: string;
}

export interface ViewConfig {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export interface RefreshCommand {
  readonly type: 'refresh';
  readonly refId: string;
  readonly affects: readonly string[];
}

export type ViewCommand = RefreshCommand;

export type ViewActionHandler<A = unknown, R = never> = Effect.Effect<A, any, R>;

export interface ViewAction<A = unknown, R = never> {
  readonly id: string;
  readonly handler: ViewActionHandler<A, R>;
}

export interface ViewComponent {
  readonly type: string;
  readonly id?: string;
  readonly [key: string]: any;
}

export interface RegisteredView {
  readonly meta: ViewMeta;
  readonly layout: readonly ViewComponent[];
  readonly queries: ReadonlyMap<string, LiveQueryRef<any>>;
  readonly streams: ReadonlyMap<string, LiveStreamRef<any>>;
  readonly actions: ReadonlyMap<string, ViewAction<any, any>>;
  readonly context: Context.Context<any>;
}
