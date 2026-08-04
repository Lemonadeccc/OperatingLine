export type CleanupStep = () => void | Promise<void>;

export async function closeAll(steps: readonly CleanupStep[]): Promise<void> {
  const errors: unknown[] = [];

  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Multiple runtime resources failed to close', {
      cause: errors[0],
    });
  }
}

export async function throwAfterCleanup(
  primaryError: unknown,
  steps: readonly CleanupStep[],
): Promise<never> {
  try {
    await closeAll(steps);
  } catch (cleanupError) {
    const cleanupErrors =
      cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError];
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      'Runtime operation failed and cleanup reported additional errors',
      { cause: cleanupError },
    );
  }
  throw primaryError;
}
