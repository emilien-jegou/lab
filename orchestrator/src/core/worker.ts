import { Observable } from 'rxjs';
import type { ScriptContext } from './script';

export interface TaskInput<T = unknown> {
  taskName: string;
  data: T;
}

type SendValues<In, Store, Trigger> = Pick<ScriptContext<In, Store, Trigger>, 'prev' | 'store'>;
export type TaskMessage<In, Store = Record<never, never>, Trigger = object> =
  | { kind: 'ready'; send: (input: SendValues<In, Store, Trigger>) => void }
  | { kind: 'console'; logType: 'log' | 'info' | 'debug' | 'error' | 'warn'; message: string }
  | {
      kind: 'success';
      result: string; // serialized Out;
      completedAt: number;
    }
  | {
      kind: 'failure';
      error: string; // serialized error;
      completedAt: number;
    }
  | { kind: 'cancelled'; reason: string; completedAt: number };

export const createTaskObservable = <In, Store, Trigger>(
  path: string,
): Observable<TaskMessage<In, Store>> =>
  new Observable((subscriber) => {
    const worker = new Worker(path);

    worker.onmessage = (event: MessageEvent<'pong' | TaskMessage<In, Store, Trigger>>) => {
      if (event.data === 'pong') {
        subscriber.next({
          kind: 'ready',
          send: (input: SendValues<In, Store, Trigger>) => {
            worker.postMessage(input);
          },
        });
      } else {
        subscriber.next(event.data);
      }
    };

    worker.onerror = (error) => {
      subscriber.error(error);
    };

    worker.postMessage('ping');
    return () => worker.terminate();
  });
