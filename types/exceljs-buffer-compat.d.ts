export {};

declare global {
  interface BufferConstructor {
    from(arrayBuffer: ArrayBuffer): ArrayBuffer;
  }
}
