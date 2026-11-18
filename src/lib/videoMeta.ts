// Filming time from an MP4/MOV file's movie header (moov/mvhd creation_time).
// Phone cameras write it when recording; edited or re-exported files may
// carry the export time or zero instead.

/** Reads `length` bytes at `offset` (fewer at the end of the file). */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

const MP4_EPOCH_MS = Date.UTC(1904, 0, 1);
/** Earliest filming time accepted as real (older values are defaults or errors). */
const EARLIEST_MS = Date.UTC(2005, 0, 1);
/** Stop after this many top-level boxes (malformed files). */
const MAX_BOXES = 64;

function u32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}
function u64(b: Uint8Array, o: number): number {
  return u32(b, o) * 2 ** 32 + u32(b, o + 4);
}
function type(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
}

/** Box header at `offset`: total size (0 = to end of file) and header length. */
async function header(read: ByteReader, offset: number, fileSize: number) {
  const h = await read(offset, 16);
  if (h.length < 8) return null;
  let size = u32(h, 0);
  let len = 8;
  if (size === 1) {
    if (h.length < 16) return null;
    size = u64(h, 8);
    len = 16;
  } else if (size === 0) size = fileSize - offset;
  if (size < len) return null;
  return { size, len, type: type(h, 4) };
}

/**
 * Filming time (ISO, UTC) from the movie header, or null when the file has
 * none or it is implausible (zero, before 2005, or in the future).
 */
export async function readFilmedAt(
  read: ByteReader,
  fileSize: number,
  nowMs = Date.now(),
): Promise<string | null> {
  let offset = 0;
  for (let n = 0; n < MAX_BOXES && offset + 8 <= fileSize; n++) {
    const box = await header(read, offset, fileSize);
    if (!box) return null;
    if (box.type === 'moov') {
      // mvhd is normally the first child; scan the first children only.
      let child = offset + box.len;
      const end = offset + box.size;
      for (let k = 0; k < 16 && child + 8 <= end; k++) {
        const c = await header(read, child, fileSize);
        if (!c) return null;
        if (c.type === 'mvhd') {
          const b = await read(child + c.len, 12);
          if (b.length < 8) return null;
          const secs = b[0] === 1 ? (b.length >= 12 ? u64(b, 4) : NaN) : u32(b, 4);
          const ms = MP4_EPOCH_MS + secs * 1000;
          if (!Number.isFinite(ms) || ms < EARLIEST_MS || ms > nowMs + 86_400_000) return null;
          return new Date(ms).toISOString();
        }
        child += c.size;
      }
      return null;
    }
    offset += box.size;
  }
  return null;
}

/** ByteReader over a browser File/Blob. */
export function blobReader(blob: Blob): ByteReader {
  return async (offset, length) =>
    new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
}
