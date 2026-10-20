import { test, expect, vi, afterEach } from 'vitest';
import { CacheManager } from '../cache-manager';
import { OPFSBackend } from './opfs';

// code injected in front of the OPFS worker, to fake bad write() results
const workerPatch = vi.hoisted(() => ({ code: '' }));

vi.mock('../utils', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils')>();
  return {
    ...mod,
    createWorker: (code: string) => mod.createWorker(workerPatch.code + code),
  };
});

// write at most 1/3 of each request
const PARTIAL_WRITE_PATCH = `
const origWrite = FileSystemSyncAccessHandle.prototype.write;
FileSystemSyncAccessHandle.prototype.write = function (buf, opts) {
  const n = Math.ceil(buf.byteLength / 3);
  return origWrite.call(this, buf.subarray(0, n), opts);
};
`;

// Chrome returns an error code as byte count when quota runs out
const QUOTA_WRITE_PATCH = `
let quotaLeft = 1000;
const origWrite = FileSystemSyncAccessHandle.prototype.write;
FileSystemSyncAccessHandle.prototype.write = function (buf, opts) {
  if (quotaLeft <= 0) return 2 ** 32 - 8;
  const n = Math.min(buf.byteLength, quotaLeft);
  quotaLeft -= n;
  return origWrite.call(this, buf.subarray(0, n), opts);
};
`;

function chunkStream(buf: Uint8Array, chunkSize = 1000) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < buf.byteLength; i += chunkSize) {
        controller.enqueue(buf.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
}

afterEach(() => {
  workerPatch.code = '';
  vi.unstubAllGlobals();
});

test.sequential('write handles partial writes', async () => {
  workerPatch.code = PARTIAL_WRITE_PATCH;
  const backend = new OPFSBackend();
  const buf = crypto.getRandomValues(new Uint8Array(10_000));

  await backend.write('test-partial-write', chunkStream(buf));
  const blob = await backend.read('test-partial-write');
  expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(buf);

  await backend.delete('test-partial-write');
});

test.sequential('write fails and deletes file on bad write count', async () => {
  workerPatch.code = QUOTA_WRITE_PATCH;
  const backend = new OPFSBackend();
  const buf = crypto.getRandomValues(new Uint8Array(10_000));

  await expect(
    backend.write('test-quota-write', chunkStream(buf))
  ).rejects.toThrow(/write failed at offset 1000/);
  expect(await backend.getSize('test-quota-write')).toBe(-1);
});

test.sequential('download fails on size mismatch', async () => {
  const url = 'https://example.com/truncated.gguf';
  const body = crypto.getRandomValues(new Uint8Array(1000));
  vi.stubGlobal('fetch', async () => {
    return new Response(body, { headers: { 'content-length': '5000' } });
  });
  const cacheManager = new CacheManager([new OPFSBackend()]);

  await expect(cacheManager.download(url)).rejects.toThrow(
    /expected 5000 bytes, received 1000/
  );
  const name = await cacheManager.getNameFromURL(url);
  expect(await cacheManager.getSize(name)).toBe(-1);
  expect(await cacheManager.getMetadata(name)).toBeNull();
});
