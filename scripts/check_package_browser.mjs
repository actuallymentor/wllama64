import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from 'playwright';

const TINY_MODEL =
  'https://huggingface.co/ggml-org/models/resolve/499bc8821c6b12b4e53c5bffcb21ec206f212d81/tinyllamas/stories15M-q4_0.gguf';

/** Run real inference with installed package assets and the published fallback. */
export async function checkPackageBrowser(installedPackage) {
  const app = express();
  app.use((_request, response, next) => {
    response.set({
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    next();
  });
  app.get('/', (_request, response) =>
    response.send('<!doctype html><title>Package inference</title>')
  );
  app.use('/package', express.static(installedPackage));

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.on('error', reject);
  });
  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    for (const bundle of ['index.js', 'index.min.js']) {
      for (const compat of [false, true]) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors = [];
        const responses = new Map();
        page.on('pageerror', (error) => errors.push(error.message));
        context.on('response', (response) =>
          responses.set(response.url(), response.status())
        );
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        let timeout;
        try {
          if (compat) {
            // Hide JSPI only in the page. Workers execute the native wasm32 runtime.
            await page.addInitScript(() => {
              Object.defineProperty(WebAssembly, 'Suspending', {
                configurable: true,
                value: undefined,
              });
            });
          }
          await page.goto(`http://127.0.0.1:${server.address().port}/`);
          const inference = page.evaluate(
            async ({ bundle, model, useCDN }) => {
              const { Wllama, WasmFromCDN, WasmCompatFromCDN } = await import(
                `/package/esm/${bundle}`
              );
              const wllama = new Wllama(
                useCDN
                  ? WasmFromCDN
                  : { default: '/package/esm/wasm/wllama.wasm' }
              );
              try {
                await wllama.loadModelFromUrl(model, {
                  n_ctx: 256,
                  n_threads: 1,
                  n_gpu_layers: 0,
                });
                const completion = await wllama.createCompletion({
                  prompt: 'Once upon a time',
                  max_tokens: 4,
                  seed: 42,
                  temperature: 0,
                });
                return {
                  resources: wllama.getWorkerResources(),
                  expectedCompat: WasmCompatFromCDN,
                  expectedDefault: WasmFromCDN.default,
                  text: completion.choices[0].text,
                  loaded: wllama.isModelLoaded(),
                };
              } finally {
                await wllama.exit();
              }
            },
            {
              bundle,
              model: TINY_MODEL,
              useCDN: process.env.WLLAMA_PACKAGE_CDN === '1',
            }
          );

          const result = await Promise.race([
            inference,
            new Promise((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error('Package inference timed out')),
                120_000
              );
            }),
          ]);

          assert.equal(result.loaded, true);
          assert.equal(result.resources.compat, compat);
          assert.equal(result.text, ', there was a');
          if (!compat && process.env.WLLAMA_PACKAGE_CDN === '1') {
            assert.equal(result.resources.wasmPath, result.expectedDefault);
            assert.equal(
              responses.get(result.expectedDefault),
              200,
              'Published default Wasm must load'
            );
          }
          if (compat) {
            assert.equal(result.resources.jsPath, result.expectedCompat.worker);
            assert.equal(result.resources.wasmPath, result.expectedCompat.wasm);
            for (const url of Object.values(result.expectedCompat)) {
              assert.equal(
                responses.get(url),
                200,
                `Published compat asset must load: ${url}`
              );
            }
          }
          assert.deepEqual(errors, []);
          console.log(
            `Package inference passed: ${bundle}, ${compat ? 'CDN compat' : 'Memory64'}: ${JSON.stringify(result.text)}`
          );
        } catch (error) {
          throw new Error(
            `Package inference failed: ${bundle}, compat=${compat}; ${errors.join('; ')}`,
            { cause: error }
          );
        } finally {
          clearTimeout(timeout);
          await context.close();
        }
      }
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
