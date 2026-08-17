#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const SECTION_IMPORT = 2;
const IMPORT_FUNCTION = 0;
const IMPORT_TABLE = 1;
const IMPORT_MEMORY = 2;
const IMPORT_GLOBAL = 3;
const IMPORT_TAG = 4;

class WasmReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  byte() {
    if (this.offset >= this.bytes.length) throw new Error('Unexpected EOF');
    return this.bytes[this.offset++];
  }

  byteslice(length) {
    const end = this.offset + length;
    if (end > this.bytes.length) throw new Error('Unexpected EOF');
    const result = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return result;
  }

  uleb() {
    let result = 0n;
    let shift = 0n;

    for (;;) {
      const byte = this.byte();
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
      if (shift > 70n) throw new Error('Invalid ULEB128 value');
    }
  }

  name() {
    return new TextDecoder().decode(this.byteslice(Number(this.uleb())));
  }

  limits() {
    const flags = this.byte();
    const minimum = this.uleb();
    const maximum = flags & 1 ? this.uleb() : null;

    return {
      maximum,
      memory64: !!(flags & 4),
      minimum,
      shared: !!(flags & 2),
    };
  }
}

const readImportedMemories = (path) => {
  const reader = new WasmReader(readFileSync(path));
  const magic = [...reader.byteslice(8)];
  const expectedMagic = [0, 97, 115, 109, 1, 0, 0, 0];

  if (!magic.every((byte, index) => byte === expectedMagic[index])) {
    throw new Error(`${path} is not a WebAssembly module`);
  }

  while (reader.offset < reader.bytes.length) {
    const sectionId = reader.byte();
    const sectionSize = Number(reader.uleb());
    const sectionEnd = reader.offset + sectionSize;

    if (sectionId !== SECTION_IMPORT) {
      reader.offset = sectionEnd;
      continue;
    }

    const memories = [];
    const importCount = Number(reader.uleb());

    for (let index = 0; index < importCount; index++) {
      const module = reader.name();
      const name = reader.name();
      const kind = reader.byte();

      switch (kind) {
        case IMPORT_FUNCTION:
          reader.uleb();
          break;
        case IMPORT_TABLE:
          reader.byte();
          reader.limits();
          break;
        case IMPORT_MEMORY:
          memories.push({ module, name, ...reader.limits() });
          break;
        case IMPORT_GLOBAL:
          reader.byteslice(2);
          break;
        case IMPORT_TAG:
          reader.byte();
          reader.uleb();
          break;
        default:
          throw new Error(`${path} has unknown import kind ${kind}`);
      }
    }

    if (reader.offset !== sectionEnd) {
      throw new Error(`${path} import section was not parsed exactly`);
    }

    return memories;
  }

  return [];
};

const assertMemory = (path, expected) => {
  const memories = readImportedMemories(path);
  if (memories.length !== 1) {
    throw new Error(`${path} must import exactly one memory`);
  }

  const actual = memories[0];
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(
        `${path} expected ${key}=${value}, received ${actual[key]}`
      );
    }
  }

  console.log(
    `${path}: ${actual.memory64 ? 'memory64' : 'wasm32'}, ${actual.minimum}-${actual.maximum} pages, shared`
  );
};

assertMemory('src/wasm/wllama.wasm', {
  maximum: 262144n,
  memory64: true,
  minimum: 2048n,
  shared: true,
});
assertMemory('compat/wasm/wllama.wasm', {
  maximum: 65536n,
  memory64: false,
  minimum: 2048n,
  shared: true,
});
