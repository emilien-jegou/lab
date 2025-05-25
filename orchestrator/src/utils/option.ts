export type Option<T = unknown> = Some<T> | None;

export type Some<T> = { kind: 'some'; value: T };

export type None = { kind: 'none' };

export const some = <T>(value: T): Some<T> => ({
  kind: 'some',
  value: value,
});

export const none = (): None => ({ kind: 'none' });

export const fromNullable = <T>(data: T | undefined | null): Option<T> =>
  data ? some(data) : none();

export const mapSome =
  <T, V>(cb: (d: T) => V) =>
  (o: Option<T>) => {
    if (o.kind == 'some') {
      return some(cb(o.value));
    } else {
      return o;
    }
  };

export const chainSome =
  <T, V>(cb: (d: T) => V) =>
  (o: Option<T>) => {
    if (o.kind == 'some') {
      return cb(o.value);
    } else {
      return o;
    }
  };
