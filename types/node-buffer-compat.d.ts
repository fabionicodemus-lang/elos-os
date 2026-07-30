declare global {
  interface Uint8Array<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> {
    toString(encoding?: BufferEncoding, start?: number, end?: number): string;
  }
}

export {};
