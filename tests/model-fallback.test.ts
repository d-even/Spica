import { ApiError } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';

import { generateWithFallback } from '@/server/agent/claude';

const failure = (status: number) => new ApiError({ status, message: `failed with ${status}` });
const models = ['first', 'second', 'third'];

describe('generateWithFallback', () => {
  it('uses the first model when it answers', async () => {
    const generate = vi.fn(async (model: string) => model);
    await expect(generateWithFallback(models, generate)).resolves.toEqual({ result: 'first', models });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([429, 503, 404])('moves past a %i and stays on the model that answered', async (status) => {
    const generate = vi.fn(async (model: string) => {
      if (model === 'first') throw failure(status);
      return model;
    });
    await expect(generateWithFallback(models, generate)).resolves.toEqual({ result: 'second', models: ['second', 'third'] });
  });

  it('moves past a model that never responds', async () => {
    const generate = vi.fn(async (model: string) => {
      if (model === 'first') throw new DOMException('timed out', 'TimeoutError');
      return model;
    });
    await expect(generateWithFallback(models, generate)).resolves.toMatchObject({ result: 'second' });
  });

  it.each([400, 401, 403])('stops on a %i, which every model would repeat', async (status) => {
    const generate = vi.fn(async () => {
      throw failure(status);
    });
    await expect(generateWithFallback(models, generate)).rejects.toThrow(`failed with ${status}`);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('reports the last failure when every model is out', async () => {
    const generate = vi.fn(async () => {
      throw failure(429);
    });
    await expect(generateWithFallback(models, generate)).rejects.toMatchObject({ status: 429 });
    expect(generate).toHaveBeenCalledTimes(3);
  });
});
