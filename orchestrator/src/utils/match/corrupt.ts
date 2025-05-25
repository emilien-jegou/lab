export const corrupt = (unreachable: never): never => {
  const safeStringify = (value: any) => {
    if (typeof value === 'symbol') {
      return value.toString();
    }

    if (value === undefined) {
      return 'undefined';
    }

    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch (error) {
      if (error instanceof TypeError) {
        if (typeof value === 'bigint') {
          return `${value.toString()} (bigint)`;
        }

        return 'circular object';
      }

      throw error;
    }
  };

  throw new TypeError(
    `Internal Error: encountered impossible value "${safeStringify(unreachable)}"`,
  );
};
