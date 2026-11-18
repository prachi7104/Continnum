// Allows the dependency-independent tests to run directly on Node when npm is unavailable.
const runner: (name: string, run: () => void | Promise<void>) => void =
  process.env.VITEST ? (await import('vitest')).test : (await import('node:test')).test;
export function test(name: string, run: () => void | Promise<void>) {
  runner(name, run);
}
