export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise(r => setTimeout(r, intervalMs));
  }
}
