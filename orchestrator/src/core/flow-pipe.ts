import type { Flow } from './flow';
import type { Script } from './script';
import type { Trigger } from './trigger';

export function flowPipe<A, B>(op1: Script<A, B>): Flow<A, B>;
export function flowPipe<A, B, C>(op1: Script<A, B>, op2: Script<B, C>): Flow<A, C>;
export function flowPipe<A, B, C, D>(
  op1: Script<A, B>,
  op2: Script<B, C>,
  op3: Script<C, D>,
): Flow<A, D>;
export function flowPipe<A, B, C, D, E>(
  op1: Script<A, B>,
  op2: Script<B, C>,
  op3: Script<C, D>,
  op4: Script<D, E>,
): Flow<A, E>;
export function flowPipe<A, B, C, D, E, F>(
  op1: Script<A, B>,
  op2: Script<B, C>,
  op3: Script<C, D>,
  op4: Script<D, E>,
  op5: Script<E, F>,
): Flow<A, F>;
export function flowPipe<A, B, C, D, E, F, G>(
  op1: Script<A, B>,
  op2: Script<B, C>,
  op3: Script<C, D>,
  op4: Script<D, E>,
  op5: Script<E, F>,
  op6: Script<F, G>,
): Flow<A, G>;
export function flowPipe<A, B, C, D, E, F, G, H>(
  op1: Script<A, B>,
  op2: Script<B, C>,
  op3: Script<C, D>,
  op4: Script<D, E>,
  op5: Script<E, F>,
  op6: Script<F, G>,
  op7: Script<G, H>,
): Flow<A, H>;
export function flowPipe<A, B, C, D, E, F, G, H, I>(
  op1: Script<A, B>,
  op2: Script<B, C>,
  op3: Script<C, D>,
  op4: Script<D, E>,
  op5: Script<E, F>,
  op6: Script<F, G>,
  op7: Script<G, H>,
  op8: Script<H, I>,
): Flow<A, I>;
export function flowPipe<A, B, C, D, E, F, G, H, I, J>(
  op1: Script<A, B>,
  op2: Script<B, C>,
  op3: Script<C, D>,
  op4: Script<D, E>,
  op5: Script<E, F>,
  op6: Script<F, G>,
  op7: Script<G, H>,
  op8: Script<H, I>,
  op9: Script<I, J>,
): Flow<A, J>;
export function flowPipe<A, B, C, D, E, F, G, H, I, J, K>(
  op01: Script<A, B>,
  op02: Script<B, C>,
  op03: Script<C, D>,
  op04: Script<D, E>,
  op05: Script<E, F>,
  op06: Script<F, G>,
  op07: Script<G, H>,
  op08: Script<H, I>,
  op09: Script<I, J>,
  op10: Script<J, K>,
): Flow<A, K>;
export function flowPipe<A, B, C, D, E, F, G, H, I, J, K, L>(
  op01: Script<A, B>,
  op02: Script<B, C>,
  op03: Script<C, D>,
  op04: Script<D, E>,
  op05: Script<E, F>,
  op06: Script<F, G>,
  op07: Script<G, H>,
  op08: Script<H, I>,
  op09: Script<I, J>,
  op10: Script<J, K>,
  op11: Script<K, L>,
): Flow<A, L>;
export function flowPipe<A, B, C, D, E, F, G, H, I, J, K, L, M>(
  op01: Script<A, B>,
  op02: Script<B, C>,
  op03: Script<C, D>,
  op04: Script<D, E>,
  op05: Script<E, F>,
  op06: Script<F, G>,
  op07: Script<G, H>,
  op08: Script<H, I>,
  op09: Script<I, J>,
  op10: Script<J, K>,
  op11: Script<K, L>,
  op12: Script<L, M>,
): Flow<A, M>;
export function flowPipe<A, B, C, D, E, F, G, H, I, J, K, L, M, N>(
  op01: Script<A, B>,
  op02: Script<B, C>,
  op03: Script<C, D>,
  op04: Script<D, E>,
  op05: Script<E, F>,
  op06: Script<F, G>,
  op07: Script<G, H>,
  op08: Script<H, I>,
  op09: Script<I, J>,
  op10: Script<J, K>,
  op11: Script<K, L>,
  op12: Script<L, M>,
  op13: Script<M, N>,
): Flow<A, N>;
export function flowPipe<A, B, C, D, E, F, G, H, I, J, K, L, M, N, O>(
  op01: Script<A, B>,
  op02: Script<B, C>,
  op03: Script<C, D>,
  op04: Script<D, E>,
  op05: Script<E, F>,
  op06: Script<F, G>,
  op07: Script<G, H>,
  op08: Script<H, I>,
  op09: Script<I, J>,
  op10: Script<J, K>,
  op11: Script<K, L>,
  op12: Script<L, M>,
  op13: Script<M, N>,
  op14: Script<N, O>,
): Flow<A, O>;
export function flowPipe<A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P>(
  op01: Script<A, B>,
  op02: Script<B, C>,
  op03: Script<C, D>,
  op04: Script<D, E>,
  op05: Script<E, F>,
  op06: Script<F, G>,
  op07: Script<G, H>,
  op08: Script<H, I>,
  op09: Script<I, J>,
  op10: Script<J, K>,
  op11: Script<K, L>,
  op12: Script<L, M>,
  op13: Script<M, N>,
  op14: Script<N, O>,
  op15: Script<O, P>,
): Flow<A, P>;

export function flowPipe(...operations: Script[]): Flow<unknown, unknown> {
  const _triggers: Trigger<unknown>[] = [];

  return {
    kind: 'flow',
    name: this.name,
    _triggers,
    trigger(t: Trigger<unknown>) {
      _triggers.push(t);
      return this;
    },
    run: (value: unknown) => operations.reduce((acc, v) => v.run(acc), value),
  };
}
