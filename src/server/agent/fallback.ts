/** Bad keys and bad requests would fail the same way on every model. */
const FAILS_ON_EVERY_MODEL = [400, 401, 403];

const statusOf = (error: unknown) => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
};

/**
 * Runs `generate` on the first model that answers. A run may already have paid,
 * so it should not end on one model's outage: rate limits (429), overload (503),
 * a retired model (404) or no response at all move on to the next model.
 * `models` in the result starts at the model that answered, which keeps the
 * rest of the run on it. Works with any error that carries an HTTP `status`,
 * such as `GeminiError` or the `@google/genai` SDK's `ApiError`.
 */
export async function generateWithFallback<T>(models: string[], generate: (model: string) => Promise<T>) {
  for (const [index, model] of models.entries()) {
    try {
      return { result: await generate(model), models: models.slice(index) };
    } catch (error) {
      const status = statusOf(error);
      const next = models[index + 1];
      if (!next || (status !== undefined && FAILS_ON_EVERY_MODEL.includes(status))) throw error;
      console.warn(`${model} failed (${status ?? 'no response'}), trying ${next}`);
    }
  }
  throw new Error('No agent models configured.');
}
