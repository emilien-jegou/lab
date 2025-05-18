import { Effect, Stream, FiberRef } from 'effect';
import type { ViewCommand } from './types';

export class LiveQueryRef<T> {
  readonly _tag = 'LiveQuery' as const;
  readonly id: string;
  readonly effect: Effect.Effect<T, any, any>;
  readonly parent?: LiveQueryRef<any>;
  readonly children: LiveQueryRef<any>[] = [];

  constructor(
    id: string,
    effect: Effect.Effect<T, any, any>,
    parent?: LiveQueryRef<any>,
  ) {
    this.id = id;
    this.effect = effect;
    this.parent = parent;
  }

  /**
   * Derive a projected query from the parent query without executing it eagerly.
   */
  map<U>(fn: (val: T) => U): LiveQueryRef<U> {
    const childId = `${this.id}_map_${this.children.length}`;
    const child = new LiveQueryRef<U>(
      childId,
      Effect.map(this.effect, fn),
      this,
    );
    this.children.push(child);

    if (activeBuildContext) {
      activeBuildContext.registerQuery(child);
    }

    return child;
  }

  /**
   * Emits a client refresh instruction targeting this query and all derived children.
   */
  refresh(): ViewCommand {
    const affects: string[] = [this.id];
    const collect = (q: LiveQueryRef<any>) => {
      for (const child of q.children) {
        affects.push(child.id);
        collect(child);
      }
    };
    collect(this);

    return {
      type: 'refresh',
      refId: this.id,
      affects,
    };
  }

  toJSON() {
    return {
      _type: 'LiveQuery',
      id: this.id,
      parentId: this.parent?.id,
    };
  }
}

export class LiveStreamRef<T> {
  readonly _tag = 'LiveStream' as const;
  readonly id: string;
  readonly stream: Stream.Stream<T, any, any>;

  constructor(id: string, stream: Stream.Stream<T, any, any>) {
    this.id = id;
    this.stream = stream;
  }

  toJSON() {
    return {
      _type: 'LiveStream',
      id: this.id,
    };
  }
}

export class ViewBuildContext {
  readonly queries = new Map<string, LiveQueryRef<any>>();
  readonly streams = new Map<string, LiveStreamRef<any>>();
  readonly actions = new Map<string, { id: string; handler: Effect.Effect<any, any, any> }>();

  private queryCounter = 0;
  private streamCounter = 0;
  private actionCounter = 0;

  constructor(readonly viewId: string) {}

  nextQueryId(prefix = 'query'): string {
    return `${prefix}_${++this.queryCounter}`;
  }

  nextStreamId(prefix = 'stream'): string {
    return `${prefix}_${++this.streamCounter}`;
  }

  nextActionId(prefix = 'action'): string {
    return `${prefix}_${++this.actionCounter}`;
  }

  registerQuery(ref: LiveQueryRef<any>) {
    this.queries.set(ref.id, ref);
  }

  registerStream(ref: LiveStreamRef<any>) {
    this.streams.set(ref.id, ref);
  }

  registerAction(id: string, handler: Effect.Effect<any, any, any>) {
    this.actions.set(id, { id, handler });
  }

  scanTree(items: readonly any[]) {
    const visit = (val: any) => {
      if (!val || typeof val !== 'object') return;

      if (val instanceof LiveQueryRef) {
        this.registerQuery(val);
        if (val.parent) visit(val.parent);
      } else if (val instanceof LiveStreamRef) {
        this.registerStream(val);
      } else if (val._tag === 'ViewAction') {
        this.registerAction(val.id, val.handler);
      }

      if (Array.isArray(val)) {
        for (const it of val) visit(it);
      } else {
        for (const k of Object.keys(val)) {
          if (k !== 'parent' && k !== 'children') {
            visit(val[k]);
          }
        }
      }
    };

    visit(items);
  }
}

// Scoped thread-safe contextual storage
export let activeBuildContext: ViewBuildContext | null = null;
export const setActiveBuildContext = (ctx: ViewBuildContext | null) => {
  activeBuildContext = ctx;
};
export const currentViewBuildContext = FiberRef.unsafeMake<ViewBuildContext | null>(null);

let fallbackQueryCounter = 0;
let fallbackStreamCounter = 0;

export const Live = {
  /**
   * Defers an effectful operation as a live query ref without executing it during view construction.
   */
  query: <T, E = any, R = any>(
    effect: Effect.Effect<T, E, R>,
    customId?: string,
  ): LiveQueryRef<T> => {
    const id =
      customId ??
      (activeBuildContext
        ? activeBuildContext.nextQueryId()
        : `query_${++fallbackQueryCounter}`);

    const ref = new LiveQueryRef(id, effect);
    if (activeBuildContext) {
      activeBuildContext.registerQuery(ref);
    }
    return ref;
  },

  /**
   * Defers a reactive Stream without running it.
   */
  stream: <T, E = any, R = any>(
    stream: Stream.Stream<T, E, R>,
    customId?: string,
  ): LiveStreamRef<T> => {
    const id =
      customId ??
      (activeBuildContext
        ? activeBuildContext.nextStreamId()
        : `stream_${++fallbackStreamCounter}`);

    const ref = new LiveStreamRef(id, stream);
    if (activeBuildContext) {
      activeBuildContext.registerStream(ref);
    }
    return ref;
  },
};
