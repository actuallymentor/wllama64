import type { ProxyToWorker } from './worker';
import { OPFSBackend } from './storage/opfs';
import { WllamaError } from './wllama';

const KEY_PREFIX = 'wllama64-slot_';
const MAGIC = 'wllama64-slot-v1';

const storage = new OPFSBackend();

// bytes hashed at the end of each model file; tensor data lives there, so fine-tunes with equal size still differ
const SAMPLE_BYTES = 1024 * 1024;

const sampleHash = async (blobs: Blob[]): Promise<string> => {
  const samples = blobs.map((b) => b.slice(Math.max(0, b.size - SAMPLE_BYTES)));
  const data = await new Blob(samples).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
};

export interface SlotInfo {
  key: string;
  n_tokens: number;
  n_bytes: number;
  t_ms: number;
}

export type SlotRunner = (
  action: 'save' | 'restore',
  filepath: string
) => Promise<any>;

/**
 * Save and restore the KV cache of a slot to OPFS.
 * Each file has a header with the model and context fingerprint; restore refuses any mismatch.
 */
export class SlotStore {
  private nextFileId = 0;
  private fingerprint: Promise<Record<string, unknown>> | null = null;

  constructor(
    private proxy: ProxyToWorker,
    private run: SlotRunner,
    private modelBlobs: Blob[],
    private params: Record<string, unknown>
  ) {}

  // computed on first use, so loading a model never pays for the hash
  private getFingerprint(): Promise<Record<string, unknown>> {
    this.fingerprint ??= sampleHash(this.modelBlobs).then((model_hash) => ({
      ...this.params,
      model_bytes: this.modelBlobs.reduce((sum, b) => sum + b.size, 0),
      model_hash,
    }));
    return this.fingerprint;
  }

  async save(key: string): Promise<SlotInfo> {
    const filepath = `/tmp/slot-${this.nextFileId++}.bin`;
    const res = await this.run('save', filepath);
    const state = await this.proxy.fileTake(filepath);

    const header = new TextEncoder().encode(
      JSON.stringify({ magic: MAGIC, fingerprint: await this.getFingerprint() })
    );
    const headerLen = new Uint32Array([header.byteLength]);
    const blob = new Blob([headerLen, header, state]);
    await storage.write(KEY_PREFIX + key, blob.stream());

    return {
      key,
      n_tokens: res.n_saved,
      n_bytes: blob.size,
      t_ms: res.timings.save_ms,
    };
  }

  async restore(key: string): Promise<SlotInfo> {
    const blob = await storage.read(KEY_PREFIX + key);
    if (!blob) {
      throw new WllamaError(`Slot "${key}" not found`, 'inference_error');
    }

    const headerLen = new Uint32Array(await blob.slice(0, 4).arrayBuffer())[0];
    const headerEnd = 4 + headerLen;
    let header: any = null;
    try {
      header = JSON.parse(await blob.slice(4, headerEnd).text());
    } catch (e) {
      // handled below
    }
    if (header?.magic !== MAGIC) {
      throw new WllamaError(
        `Slot "${key}" is not a valid slot file`,
        'inference_error'
      );
    }
    const fingerprint = await this.getFingerprint();
    const mismatch = Object.keys(fingerprint).filter(
      (k) => header.fingerprint?.[k] !== fingerprint[k]
    );
    if (mismatch.length > 0) {
      throw new WllamaError(
        `Slot "${key}" was saved with a different model or context (${mismatch.join(', ')})`,
        'inference_error'
      );
    }

    // the worker reads the state through the async file read path, like model files
    const fileName = `slot-${this.nextFileId++}.bin`;
    await this.proxy.fileAdd(fileName, blob.slice(headerEnd));
    try {
      const res = await this.run('restore', `/models/${fileName}`);
      return {
        key,
        n_tokens: res.n_restored,
        n_bytes: blob.size,
        t_ms: res.timings.restore_ms,
      };
    } finally {
      this.proxy.fileRemove(fileName);
    }
  }
}

export const deleteSlot = (key: string): Promise<void> =>
  storage.delete(KEY_PREFIX + key);

export const listSlots = async (): Promise<string[]> => {
  const all = await storage.list();
  return all
    .filter(({ key }) => key.startsWith(KEY_PREFIX))
    .map(({ key }) => key.slice(KEY_PREFIX.length));
};
