import { test, expect, afterEach } from 'vitest';
import { Wllama } from './wllama';

const CONFIG_PATHS = {
  default: '/src/wasm/wllama.wasm',
};

const instances: Wllama[] = [];
const nativeLogs = new WeakMap<Wllama, string[]>();

afterEach(async () => {
  await Promise.all(instances.splice(0).map((wllama) => wllama.exit()));
});

const createWllama = (): Wllama => {
  const logs: string[] = [];
  const capture = (...args: unknown[]) => logs.push(args.join(' '));
  const w = new Wllama(CONFIG_PATHS, {
    logger: { debug: capture, log: capture, warn: capture, error: capture },
  });
  nativeLogs.set(w, logs);
  instances.push(w);
  w.setCompat(null);
  return w;
};

const TINY_MODEL =
  'https://huggingface.co/ggml-org/models/resolve/main/tinyllamas/stories15M-q4_0.gguf';
// quantized KV types need a head size divisible by 32; stories15M has 48
const SMOL_MODEL =
  'https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/09816acd5d99df7be770d85ea30822623dab342c/SmolLM2-135M-Instruct-Q4_K_M.gguf';

test('WebGPU is supported in this browser', async () => {
  const adapter = await navigator.gpu?.requestAdapter();
  expect(adapter).toBeTruthy();
  expect(adapter!.features.has('shader-f16')).toBe(true);
  const { vendor, architecture, device, description, isFallbackAdapter } =
    adapter!.info;
  console.info('WebGPU adapter', {
    vendor,
    architecture,
    device,
    description,
    isFallbackAdapter,
  });
  expect(isFallbackAdapter).toBe(false);
  const wllama = createWllama();
  expect(wllama.isSupportWebGPU()).toBe(true);
});

test.sequential('loads model with WebGPU', async () => {
  const wllama = createWllama();

  expect(wllama.isSupportWebGPU()).toBe(true);

  await wllama.loadModelFromUrl(TINY_MODEL, {
    n_ctx: 1024,
    n_gpu_layers: 99999,
    n_threads: 2,
  });

  // Adapter detection alone can pass while native inference falls back to CPU.
  expect(nativeLogs.get(wllama)!.join('\n')).toMatch(
    /offloaded [1-9]\d*\/\d+ layers to GPU/
  );

  expect(wllama.isModelLoaded()).toBe(true);
  expect(wllama.getModelMetadata()).toBeDefined();
});

test.sequential('parallel completions with WebGPU', async () => {
  const wllama = createWllama();

  await wllama.loadModelFromUrl(TINY_MODEL, {
    n_ctx: 1024,
    n_gpu_layers: 99999,
    n_threads: 2,
  });

  expect(nativeLogs.get(wllama)!.join('\n')).toMatch(
    /offloaded [1-9]\d*\/\d+ layers to GPU/
  );

  const prompts = [
    'Once upon a time',
    'The little girl said',
    'One day, a boy named',
  ];
  const results = await Promise.all(
    prompts.map((prompt) =>
      wllama.createCompletion({
        prompt,
        max_tokens: 10,
        temperature: 0.0,
        seed: 42,
      })
    )
  );

  expect(results.length).toBe(prompts.length);
  for (const res of results) {
    expect(res).toBeDefined();
    expect(res.choices[0].text.length).toBeGreaterThan(0);
  }

  // greedy + fixed seed: serial reruns must produce identical text
  for (let i = 0; i < prompts.length; i++) {
    const serial = await wllama.createCompletion({
      prompt: prompts[i],
      max_tokens: 10,
      temperature: 0.0,
      seed: 42,
    });
    expect(results[i].choices[0].text).toBe(serial.choices[0].text);
  }
});

test.sequential('generates completion with WebGPU', async () => {
  const wllama = createWllama();

  expect(wllama.isSupportWebGPU()).toBe(true);

  await wllama.loadModelFromUrl(TINY_MODEL, {
    n_ctx: 1024,
    n_gpu_layers: 99999,
    n_threads: 2,
  });

  expect(nativeLogs.get(wllama)!.join('\n')).toMatch(
    /offloaded [1-9]\d*\/\d+ layers to GPU/
  );

  const res = await wllama.createCompletion({
    prompt: 'Once upon a time',
    max_tokens: 10,
    temperature: 0.0,
    top_p: 0.95,
    top_k: 40,
    seed: 42,
  });

  expect(res).toBeDefined();
  expect(res.choices[0].text.length).toBeGreaterThan(0);
});

test.sequential(
  'quantized KV cache uses flash attention on WebGPU',
  async (ctx) => {
    // WebGPU flash attention needs subgroups
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter?.features.has('subgroups')) ctx.skip();

    const wllama = createWllama();

    await wllama.loadModelFromUrl(SMOL_MODEL, {
      n_ctx: 1024,
      n_gpu_layers: 99999,
      n_threads: 2,
      cache_type_k: 'q8_0',
      cache_type_v: 'q8_0',
    });

    const logs = nativeLogs.get(wllama)!.join('\n');
    expect(logs).toMatch(/offloaded [1-9]\d*\/\d+ layers to GPU/);
    expect(logs).toMatch(/flash_attn\s+= enabled/);
    expect(logs).toMatch(/WebGPU KV buffer size/);
    expect(logs).not.toMatch(/subgroups/);

    const res = await wllama.createCompletion({
      prompt: 'Once upon a time',
      max_tokens: 10,
      temperature: 0.0,
    });
    expect(res.choices[0].text.length).toBeGreaterThan(0);
  }
);

test.sequential('warns and loads with KV type WebGPU cannot use', async () => {
  const wllama = createWllama();

  await wllama.loadModelFromUrl(SMOL_MODEL, {
    n_ctx: 1024,
    n_gpu_layers: 99999,
    n_threads: 2,
    cache_type_k: 'q5_1',
  });

  const logs = nativeLogs.get(wllama)!.join('\n');
  expect(logs).toMatch(/KV cache type q5_1 is not supported by WebGPU/);
  expect(logs).toMatch(/offloaded [1-9]\d*\/\d+ layers to GPU/);
  // weights stay on the GPU, the KV cache moves to CPU
  expect(logs).toMatch(/CPU KV buffer size/);
  expect(logs).not.toMatch(/WebGPU KV buffer size/);

  const res = await wllama.createCompletion({
    prompt: 'Once upon a time',
    max_tokens: 10,
    temperature: 0.0,
  });
  expect(res.choices[0].text.length).toBeGreaterThan(0);
});

test.sequential('saves and restores slot with WebGPU', async () => {
  const prompt = 'Once upon a time, there was a little girl named Lily.';
  const params = {
    n_ctx: 1024,
    n_gpu_layers: 99999,
    n_threads: 2,
    n_threads_batch: 4,
  };

  const wllama = createWllama();
  await wllama.loadModelFromUrl(TINY_MODEL, params);
  expect(nativeLogs.get(wllama)!.join('\n')).toMatch(
    /offloaded [1-9]\d*\/\d+ layers to GPU/
  );
  const before = await wllama.createCompletion({
    prompt,
    max_tokens: 8,
    temperature: 0.0,
  });
  const saved = await wllama.saveSlot('wgpu-slot');
  expect(saved.n_tokens).toBeGreaterThan(10);
  await wllama.exit();

  const wllama2 = createWllama();
  await wllama2.loadModelFromUrl(TINY_MODEL, params);
  const restored = await wllama2.restoreSlot('wgpu-slot');
  expect(restored.n_tokens).toBe(saved.n_tokens);
  const after = await wllama2.createCompletion({
    prompt,
    max_tokens: 8,
    temperature: 0.0,
  });
  expect(after.choices[0].text).toBe(before.choices[0].text);
  expect(after.usage?.prompt_tokens_details?.cached_tokens).toBeGreaterThan(0);
  await wllama2.deleteSlot('wgpu-slot');
});
