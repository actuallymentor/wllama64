import type { LoadModelParams } from './types/types';
import type { WllamaLogger } from './wllama';
import { isFirefox, isSupportWebGPU } from './utils';

// KV types that ggml-webgpu can write (SET_ROWS) and use in flash attention; other types run on CPU
const GPU_KV_TYPES = ['f32', 'f16', 'q8_0', 'q4_0'];

export interface GpuAdapterInfo {
  vendor: string;
  architecture: string;
  features: string[];
  maxStorageBufferBindingSize: number;
}

/**
 * Get info about the WebGPU adapter, or null if WebGPU is not available
 */
export const getGpuAdapterInfo = async (): Promise<GpuAdapterInfo | null> => {
  if (!isSupportWebGPU()) return null;
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) return null;
    return {
      vendor: adapter.info?.vendor ?? '',
      architecture: adapter.info?.architecture ?? '',
      features: [...adapter.features],
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    };
  } catch (e) {
    return null;
  }
};

/**
 * Adjust load params to avoid slow WebGPU paths. Values set by the user are kept.
 */
export const applyGpuPolicy = async (
  params: LoadModelParams,
  logger: WllamaLogger
): Promise<LoadModelParams> => {
  if (params.n_gpu_layers === 0) return params;

  // Firefox WebGPU readback is much slower than CPU inference (bugzilla 1870699)
  if (params.n_gpu_layers === undefined && isFirefox()) {
    logger.debug('Firefox detected, using CPU; set n_gpu_layers to use WebGPU');
    return { ...params, n_gpu_layers: 0 };
  }

  const adapter = await getGpuAdapterInfo();
  if (!adapter) return params;
  logger.debug('WebGPU adapter:', adapter);

  const kvTypes = new Set([params.cache_type_k, params.cache_type_v]);
  for (const type of kvTypes) {
    if (type && !GPU_KV_TYPES.includes(type)) {
      logger.warn(
        `KV cache type ${type} is not supported by WebGPU and runs on CPU; use one of: ${GPU_KV_TYPES.join(', ')}`
      );
    }
  }

  // quantized V cache needs flash attention, and WebGPU flash attention needs subgroups
  const quantizedV =
    !!params.cache_type_v && !params.cache_type_v.startsWith('f');
  if (quantizedV && !adapter.features.includes('subgroups')) {
    logger.warn(
      `KV cache type ${params.cache_type_v} needs flash attention, but this GPU has no "subgroups" feature; the model may fail to load`
    );
  }

  return params;
};
