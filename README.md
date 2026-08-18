# wllama64 — 16 GiB Memory64 fork of Wllama

![](./README_banner.png)

`wllama64` is an independent fork of [Wllama](https://github.com/ngxson/wllama),
the WebAssembly binding for [llama.cpp](https://github.com/ggerganov/llama.cpp).
It keeps the upstream browser API while raising the default WebAssembly linear
memory ceiling from 4 GiB to 16 GiB through Memory64.

Current release: `1.0.0`, based on upstream Wllama `3.6.0`
([`f16050d`](https://github.com/ngxson/wllama/commit/f16050d)).

- [Repository](https://github.com/actuallymentor/wllama64)
- [Issues](https://github.com/actuallymentor/wllama64/issues)
- [Releases](https://github.com/actuallymentor/wllama64/releases)
- [Upstream demo](https://huggingface.co/spaces/ngxson/wllama)
- [Upstream API documentation](https://github.ngxson.com/wllama/docs/)
- [WebGPU introduction](https://reeselevine.github.io/llamas-on-the-web/)

> [!NOTE]
>
> This is not an official Wllama release. Report fork-specific problems in the
> [wllama64 issue tracker](https://github.com/actuallymentor/wllama64/issues).
>
> The Memory64 build retains the Wllama V3 API, including WebGPU, multimodal,
> tool calling, parallel requests, and partial-download recovery. See the
> [upstream V3 release guide](./guides/intro-v3.md). The wasm32 fallback remains
> the upstream [@wllama/wllama-compat](./compat/README.md) build.

![](./assets/screenshot_0.png)

## Features

- 🔌 OpenAI-compatible API (fully-typed built-in)
- 🚀 WebGPU support
- 🔥 Multimodal support (image and audio file input)
- 🔥 Tool calling support
- Can run inference directly on browser (using [WebAssembly SIMD](https://emscripten.org/docs/porting/simd.html)), no backend or GPU is needed!
- No runtime dependency (see [package.json](./package.json))
- Ability to split the model into smaller files and load them in parallel (same as `split` and `cat`)
- Up to 16 GiB of WebAssembly linear memory on 64-bit Memory64 browsers, with a wasm32 compatibility fallback
- Auto switch between single-thread and multi-thread build based on browser support
- Inference is done inside a worker, does not block UI render
- Pre-built npm package [wllama64](https://www.npmjs.com/package/wllama64)

Limitations:
- The default Memory64 artifact uses shared memory. Serve it with `Cross-Origin-Embedder-Policy` and `Cross-Origin-Opener-Policy` headers. These headers are also required for multi-threading. See [this discussion](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/106#issuecomment-913450724) for more details.
- The default Memory64 build reads large model files in bounded chunks instead of materializing the full file in an `ArrayBuffer`. Splitting models into 512MB shards is still recommended for compatibility builds and constrained browsers.
- The 16 GiB value is a virtual-address ceiling, not a guarantee that a device can commit that much memory. `wllama64` grows from 128 MiB and may negotiate a lower maximum when the browser cannot reserve 16 GiB. Models also need headroom for browser overhead, input, temporary buffers, and inference state.
- The Memory64 path is validated on 64-bit Chromium 137 or newer. Other browsers require shared Memory64 and JSPI support. Unsupported browsers use the wasm32 compat build and remain limited to 4 GiB.

## Code demo and documentation

Fork examples:

- Memory64 model loading and inference stress lab: [source code](./examples/memory64/index.html)

Upstream-hosted examples retained by this fork:

- Basic usages with completions and embeddings: https://github.ngxson.com/wllama/examples/basic/ ([source code](./examples/basic/index.html))
- Embedding and cosine distance: https://github.ngxson.com/wllama/examples/embeddings/ ([source code](./examples/embeddings/index.html))
- Multimodal (vision) completion: https://github.ngxson.com/wllama/examples/multimodal/ ([source code](./examples/multimodal/index.html))
- Tool calling: https://github.ngxson.com/wllama/examples/tools/ ([source code](./examples/tools/index.html))

## How to use

### Use Wllama inside a React TypeScript project

Install it:

```bash
npm install wllama64@1.0.0
```

Copy `node_modules/wllama64/esm/wasm/wllama.wasm` to your app's public assets,
then import the module:

```ts
import { Wllama } from 'wllama64';

const wllamaInstance = new Wllama({
  default: '/wasm/wllama.wasm',
});
// (the rest is the same with earlier example)
```

For complete code example, see [examples/main/src/utils/wllama.context.tsx](./examples/main/src/utils/wllama.context.tsx)

NOTE: this example only covers completions usage. For embeddings, please see [examples/embeddings/index.html](./examples/embeddings/index.html)

### WebGPU support

WebGPU support is introduced via [PR #215](https://github.com/ngxson/wllama/pull/215).

Upon updating to V3.1, WebGPU will be enabled automatically. By default, all layers will be offloaded to GPU. If the model is too big to fit into VRAM, you can manually adjust the number of layers via the `n_gpu_layers` parameter of `LoadModelParams`. Example:

```js
// (optionally) will allow running WebGPU on Firefox via compat mode; performance will be significantly degraded
wllama.setCompat('default', 'firefox_safari');

await wllama.loadModel(files, {
  n_gpu_layers: 4, // meaning 4 layers are offloaded to GPU; set to 0 to disable GPU inference
});
```

### Prepare your model

- It is recommended to split the model into **chunks of maximum 512MB**. This will result in slightly faster download speed (because multiple splits can be downloaded in parallel), and also prevent some out-of-memory issues. **See the "Split model" section below for more details.**
- It is recommended to use quantized Q4, Q5 or Q6 for balance among performance, file size and quality. Using IQ (with imatrix) is **not** recommended, may result in slow inference and low quality.

### Simple usage with ES6 module

For complete code, see [examples/basic/index.html](./examples/basic/index.html)

```javascript
import { Wllama } from './esm/index.js';

(async () => {
  const CONFIG_PATHS = {
    default: './esm/wasm/wllama.wasm',
  };
  // Automatically switch between single-thread and multi-thread version based on browser support
  // If you want to enforce single-thread, add { "n_threads": 1 } to LoadModelConfig
  const wllama = new Wllama(CONFIG_PATHS);
  // Define a function for tracking the model download progress
  const progressCallback =  ({ loaded, total }) => {
    // Calculate the progress as a percentage
    const progressPercentage = Math.round((loaded / total) * 100);
    // Log the progress in a user-friendly format
    console.log(`Downloading... ${progressPercentage}%`);
  };
  // Load GGUF from Hugging Face hub
  // (alternatively, you can use loadModelFromUrl if the model is not from HF hub)
  await wllama.loadModelFromHF(
    { repo: 'ggml-org/models', file: 'tinyllamas/stories260K.gguf' },
    { progressCallback }
  );
  const response = await wllama.createChatCompletion({
    messages: [{ role: 'user', content: elemInput.value }],
    max_tokens: 50,
    temperature: 0.5,
    top_k: 40,
    top_p: 0.9,
  });
  console.log(response.choices[0].message.content);
})();
```

Alternatively, you can use the `*.wasm` files from CDN:

```js
import { WasmFromCDN, Wllama } from 'wllama64';

const wllama = new Wllama(WasmFromCDN);
// NOTE: this is not recommended, only use when you can't embed wasm files in your project
```

### Split model

Cases where we want to split the model:
- The wasm32 compatibility build and constrained browsers can hit a 2 GiB [ArrayBuffer size limit](https://stackoverflow.com/questions/17823225/do-arraybuffers-have-a-maximum-length), so model files larger than 2 GiB must be split in those environments. Elsewhere, the default Memory64 build reads model files in bounded chunks and does not require splitting for this reason.
- Even with a small model, splitting into chunks allows the browser to download multiple chunks in parallel, thus making the download process a bit faster.

We use `llama-gguf-split` to split a big gguf file into smaller files. You can download the pre-built binary via [llama.cpp release page](https://github.com/ggerganov/llama.cpp/releases):

```bash
# Split the model into chunks of 512 Megabytes
./llama-gguf-split --split-max-size 512M ./my_model.gguf ./my_model
```

This will output files ending with `-00001-of-00003.gguf`, `-00002-of-00003.gguf`, and so on.

You can then pass to `loadModelFromUrl` or `loadModelFromHF` the URL of the first file and it will automatically load all the chunks:

```js
const wllama = new Wllama(CONFIG_PATHS, {
  parallelDownloads: 5, // optional: maximum files to download in parallel (default: 3)
});
await wllama.loadModelFromHF({
  repo: 'ngxson/tinyllama_split_test',
  file: 'stories15M-q8_0-00001-of-00003.gguf',
});
```

### Custom logger (suppress debug messages)

When initializing Wllama, you can pass a custom logger to Wllama.

Example 1: Suppress debug message

```js
import { LoggerWithoutDebug, Wllama } from 'wllama64';

const wllama = new Wllama(pathConfig, {
  // LoggerWithoutDebug is predefined inside wllama
  logger: LoggerWithoutDebug,
});
```

Example 2: Add emoji prefix to log messages

```js
const wllama = new Wllama(pathConfig, {
  logger: {
    debug: (...args) => console.debug('🔧', ...args),
    log: (...args) => console.log('ℹ️', ...args),
    warn: (...args) => console.warn('⚠️', ...args),
    error: (...args) => console.error('☠️', ...args),
  },
});
```

## Upstream tracking

`wllama64` follows tested upstream Wllama release commits rather than arbitrary
development snapshots. The current baseline is Wllama `3.6.0` at `f16050d`.
Conflict resolutions preserve both upstream semantics and Memory64 support.

For each upstream release, maintainers fetch the
[`ngxson/wllama`](https://github.com/ngxson/wllama) remote, integrate the release
commit, reapply the narrow Memory64 adaptations, regenerate both Wasm artifacts
and worker glue, and run the upstream and Memory64 browser suites.

The daily release watcher automates this flow for conflict-free stable tags. It
opens a pull request, rebuilds both Wasm targets without credentials, and enables
auto-merge only after the complete release gates pass. A merged release publishes
through npm trusted publishing; conflicts or failed checks open an issue and
never publish. Upstream patch, minor, and major releases produce the matching
downstream version increment.

## How to compile the binary yourself

This repository includes a pre-built binary from the llama.cpp source code. However, in some cases you may want to compile it yourself:
- You don't trust the pre-built one.
- You want to try out latest - bleeding-edge changes from upstream llama.cpp source code.

You can use the commands below to compile it yourself:

```shell
# /!\ IMPORTANT: Requires Docker Compose

# Clone the repository with submodule
git clone --recurse-submodules https://github.com/actuallymentor/wllama64.git
cd wllama64

# Optionally, update llama.cpp to its latest upstream version (bleeding-edge, use at your own risk!)
# git submodule update --remote --merge

# Install the required modules
npm i

# Firstly, build llama.cpp into wasm
npm run build:wasm
# Then, build ES module
npm run build
```

## TODO

- Add support for LoRA adapter

## Acknowledgments

`wllama64` is maintained independently at
[actuallymentor/wllama64](https://github.com/actuallymentor/wllama64). Wllama was
created and is maintained by [Xuan-Son Nguyen](https://ngxson.com/). The WebGPU
backend for llama.cpp is maintained by
[Reese Levine](https://reeselevine.github.io/). We thank all contributors to
Wllama and llama.cpp, whose work made this fork possible.
