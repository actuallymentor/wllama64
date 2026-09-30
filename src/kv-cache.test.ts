import { test, expect } from 'vitest';
import { Wllama } from './wllama';

const CONFIG_PATHS = {
  default: '/src/wasm/wllama.wasm',
};

// SmolLM2 has 64-wide attention heads, which support quantized KV blocks.
const KV_MODEL =
  'https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/09816acd5d99df7be770d85ea30822623dab342c/SmolLM2-135M-Instruct-Q4_K_M.gguf';

test.sequential(
  'generates with q8_0 K/V cache and Flash Attention on CPU',
  async () => {
    const logs: string[] = [];
    const capture = (...args: unknown[]) => logs.push(args.join(' '));
    const wllama = new Wllama(CONFIG_PATHS, {
      logger: { debug: capture, log: capture, warn: capture, error: capture },
    });
    wllama.setCompat(null);

    try {
      await wllama.loadModelFromUrl(KV_MODEL, {
        n_ctx: 256,
        n_threads: 2,
        n_gpu_layers: 0,
        cache_type_k: 'q8_0',
        cache_type_v: 'q8_0',
        flash_attn: true,
      });

      const result = await wllama.createCompletion({
        prompt: 'Once upon a time',
        max_tokens: 8,
        temperature: 0,
        seed: 42,
      });

      expect(result.choices[0].text.length).toBeGreaterThan(0);
      expect(logs.join('\n')).toMatch(/K \(q8_0\).*V \(q8_0\)/);
      expect(logs.join('\n')).toMatch(/flash_attn\s*=\s*enabled/);
    } finally {
      await wllama.exit();
    }
  },
  120_000
);
