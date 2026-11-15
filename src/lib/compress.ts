// gzip + base64 for keypoint blobs (CompressionStream: iOS Safari 16.4+, Chrome 80+).
import { decodeKeypoints, encodeKeypoints, fromBase64, toBase64 } from '../analysis/codec';
import type { PoseSequence } from '../analysis/types';

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Prefix marks the encoding so old/uncompressed data stays readable. */
export async function packKeypoints(seq: PoseSequence): Promise<string> {
  const raw = encodeKeypoints(seq);
  if (typeof CompressionStream === 'undefined') return `raw:${toBase64(raw)}`;
  return `gz:${toBase64(await pipe(raw, new CompressionStream('gzip')))}`;
}

export async function unpackKeypoints(s: string): Promise<PoseSequence> {
  if (s.startsWith('raw:')) return decodeKeypoints(fromBase64(s.slice(4)));
  if (s.startsWith('gz:'))
    return decodeKeypoints(await pipe(fromBase64(s.slice(3)), new DecompressionStream('gzip')));
  throw new Error('unknown keypoint encoding');
}
