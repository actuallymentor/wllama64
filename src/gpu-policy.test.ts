import { test, expect, afterEach, vi } from 'vitest';
import { applyGpuPolicy } from './gpu-policy';

const realUserAgent = navigator.userAgent;

const mockNavigator = (userAgent: string, features: string[] | null) => {
  Object.defineProperty(navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  });
  Object.defineProperty(navigator, 'gpu', {
    value: {
      requestAdapter: async () =>
        features && {
          info: { vendor: 'test', architecture: 'test' },
          features: new Set(features),
          limits: { maxStorageBufferBindingSize: 1 << 30 },
        },
    },
    configurable: true,
  });
};

const createLogger = () => ({
  debug: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

afterEach(() => {
  // drop the own-property overrides so the prototype getters are used again
  delete (navigator as any).userAgent;
  delete (navigator as any).gpu;
  expect(navigator.userAgent).toBe(realUserAgent);
});

test('Firefox defaults to CPU', async () => {
  mockNavigator('Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0', []);
  const logger = createLogger();
  expect(await applyGpuPolicy({}, logger)).toEqual({ n_gpu_layers: 0 });
  // explicit n_gpu_layers is kept
  expect(await applyGpuPolicy({ n_gpu_layers: 10 }, logger)).toEqual({
    n_gpu_layers: 10,
  });
});

test('warns on KV types WebGPU cannot use', async () => {
  mockNavigator('Chrome/140.0', ['shader-f16', 'subgroups']);
  const logger = createLogger();
  const params = { cache_type_k: 'q5_1', cache_type_v: 'q8_0' } as const;
  expect(await applyGpuPolicy(params, logger)).toEqual(params);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.warn.mock.calls[0][0]).toMatch(/q5_1/);
});

test('warns on quantized V cache without subgroups', async () => {
  mockNavigator('Chrome/140.0', ['shader-f16']);
  const logger = createLogger();
  await applyGpuPolicy({ cache_type_v: 'q8_0' }, logger);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.warn.mock.calls[0][0]).toMatch(/subgroups/);
});

test('no adapter or CPU-only keeps params', async () => {
  mockNavigator('Chrome/140.0', null);
  const logger = createLogger();
  expect(await applyGpuPolicy({ cache_type_k: 'q5_1' }, logger)).toEqual({
    cache_type_k: 'q5_1',
  });
  expect(await applyGpuPolicy({ n_gpu_layers: 0 }, logger)).toEqual({
    n_gpu_layers: 0,
  });
  expect(logger.warn).not.toHaveBeenCalled();
});
