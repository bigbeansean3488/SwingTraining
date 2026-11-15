// MP4/MOV container parsing with mp4box.js: gives exact frame timestamps
// (the real frame rate) and the encoded samples for WebCodecs decoding.
import { createFile, DataStream, Endianness, MP4BoxBuffer, type Movie, type Sample } from 'mp4box';

export interface DemuxedVideo {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  /** Codec configuration record (avcC/hvcC/vpcC/av1C payload) for VideoDecoder. */
  description?: Uint8Array;
  /** Clockwise display rotation from the track matrix (0/90/180/270). */
  rotation: number;
  timescale: number;
  /** Subtracted from sample CTS so times match <video>.currentTime. */
  timeOffset: number;
  /** Samples in decode order. */
  samples: Sample[];
  /** Presentation times (seconds), sorted ascending. */
  frameTimes: number[];
  /** Median frame rate from presentation times. */
  fps: number;
  durationS: number;
}

export async function demuxVideo(file: Blob): Promise<DemuxedVideo> {
  const mp4 = createFile();
  let failure: string | null = null;
  let info: Movie | null = null;
  const samples: Sample[] = [];
  mp4.onError = (_m, msg) => {
    failure = msg;
  };
  mp4.onReady = (movie) => {
    info = movie;
    const track = movie.videoTracks[0];
    if (!track) return;
    mp4.onSamples = (_id, _user, s) => {
      samples.push(...s);
    };
    mp4.setExtractionOptions(track.id, null, { nbSamples: 500 });
    mp4.start();
  };
  // Feed the file in chunks; mp4box keeps the buffers it needs for sample data.
  const CHUNK = 8 * 1024 * 1024;
  let offset = 0;
  while (offset < file.size) {
    const ab = await file.slice(offset, offset + CHUNK).arrayBuffer();
    mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, offset), offset + CHUNK >= file.size);
    offset += CHUNK;
    if (failure) throw new Error(`container parse error: ${failure}`);
  }
  mp4.flush();
  const movie = info as Movie | null;
  const track = movie?.videoTracks[0];
  if (!movie || !track) throw new Error('container not recognized');
  if (!samples.length) throw new Error('no samples extracted');

  const trak = mp4.getTrackById(track.id);
  const m = track.matrix;
  const rotation =
    (((Math.round((Math.atan2(Number(m[1]), Number(m[0])) * 180) / Math.PI / 90) * 90) % 360) +
      360) %
    360;
  const edit = track.edits?.find((e) => e.media_time >= 0);
  const timeOffset = edit ? edit.media_time : Math.min(...samples.map((s) => s.cts));
  const frameTimes = samples.map((s) => (s.cts - timeOffset) / s.timescale).sort((a, b) => a - b);
  const dts: number[] = [];
  for (let i = 1; i < frameTimes.length; i++) dts.push(frameTimes[i]! - frameTimes[i - 1]!);
  dts.sort((a, b) => a - b);
  const med = dts[dts.length >> 1] ?? 0;
  return {
    codec: track.codec,
    codedWidth: track.video?.width ?? track.track_width,
    codedHeight: track.video?.height ?? track.track_height,
    description: codecDescription(trak),
    rotation,
    timescale: track.timescale,
    timeOffset,
    samples,
    frameTimes,
    fps: med > 0 ? 1 / med : NaN,
    durationS: track.duration / track.timescale,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function codecDescription(trak: any): Uint8Array | undefined {
  for (const entry of trak?.mdia?.minf?.stbl?.stsd?.entries ?? []) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer as ArrayBuffer, 8); // drop the box header
    }
  }
  return undefined;
}
