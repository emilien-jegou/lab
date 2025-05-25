import { Observable } from 'rxjs';
import type { ScriptContext } from './script';

export interface TaskInput<T = unknown> {
  taskName: string;
  data: T;
}

type SendValues<In, Ext> = Omit<ScriptContext<In, Ext>, 'cancel'>;
export type TaskMessage<In, Ext> =
  | { kind: 'ready'; send: (input: SendValues<In, Ext>) => void }
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

export const createTaskObservable = <In, Ext>(path: string): Observable<TaskMessage<In, Ext>> =>
  new Observable((subscriber) => {
    const worker = new Worker(path);

    worker.onmessage = (event: MessageEvent<'pong' | TaskMessage<In, Ext>>) => {
      if (event.data === 'pong') {
        subscriber.next({
          kind: 'ready',
          send: (input: SendValues<In, Ext>) => {
            try {
              const message = JSON.parse(JSON.stringify(input));
              worker.postMessage(message);
            } catch (err) {
              console.error('Error during message parsing');
              throw err;
            }
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
