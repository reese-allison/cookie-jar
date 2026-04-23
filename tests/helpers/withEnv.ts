/**
 * Set a process.env var for the duration of `fn`, restoring the original
 * value (including "unset") afterwards. Survives thrown errors.
 */
export async function withEnv<T>(
  name: string,
  value: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const prev = process.env[name];
  process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}
