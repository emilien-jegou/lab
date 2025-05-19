type Observer<T> = (value: T) => void;

export type Signal<T> = {
  get value(): T;
  set value(value: T);
  subscribe: (observer: Observer<T>) => () => void; // unsubscribe function
};

export const createSignal = <T>(initialValue: T): Signal<T> => {
  let value = initialValue;
  let observers: Observer<T>[] = [];

  const subscribe = (observer: Observer<T>) => {
    observers.push(observer);
    // immediately notify with current value
    observer(value);
    return () => {
      observers = observers.filter((o) => o !== observer);
    };
  };

  return {
    get value() {
      return value;
    },
    set value(newValue: T) {
      if (value === newValue) return;
      value = newValue;
      observers.forEach((observer) => observer(value));
    },
    subscribe,
  };
};
