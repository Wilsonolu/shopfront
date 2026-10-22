export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Parse a positive integer from user input or throw 400. */
export function intField(value, name, { min = 0 } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min) throw new HttpError(400, `${name} must be an integer >= ${min}`);
  return n;
}
