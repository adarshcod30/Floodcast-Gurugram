/**
 * Photo preparation: downscale, re-encode, strip metadata.
 *
 * A phone camera photo is 3 to 8 MB. Uploading that during the storm you
 * want it from is exactly when the network is worst, so it is downscaled on
 * the device first. Around 300 KB is plenty to show that a road is
 * knee-deep, and it uploads on a congested 3G connection where the original
 * would time out.
 *
 * Re-encoding through a canvas also drops every EXIF tag, which is a
 * privacy feature rather than a side effect. Camera EXIF carries its own GPS
 * fix, the device model, and often a serial number. The person agreed to
 * share where the water is, not to hand over a device fingerprint, and the
 * coordinate this app sends is the one they were shown and accepted.
 */

/** Long edge in pixels. Enough to read a kerb line, small enough to send. */
const MAX_EDGE = 1600;
const QUALITY = 0.82;
/** Refuse anything absurd before it reaches a decoder. */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  /** When the camera says the shutter fired, if the file admitted it.
   *
   *  Read out before the re-encode strips every tag, and kept for one
   *  narrow purpose: a moderator can see whether a photo was taken minutes
   *  before the report or is a file from last year. It is a signal, not
   *  proof. EXIF is trivially editable and a determined faker will strip or
   *  forge it, so this raises the effort required and nothing more. */
  taken_at: Date | null;
  /** True when the file arrived through a camera-capture input. Also only a
   *  signal: `capture` is a hint browsers may ignore, and the public anon
   *  key means anyone can POST to the API without touching this app at all. */
  from_camera: boolean;
}

/**
 * Read EXIF DateTimeOriginal, and nothing else.
 *
 * Deliberately narrow. Camera EXIF also carries its own GPS fix, the device
 * model and often a serial number, none of which anybody agreed to share by
 * photographing a flooded road. Only the timestamp is lifted; the re-encode
 * below then discards the entire block, GPS included.
 */
export async function readTakenAt(file: Blob): Promise<Date | null> {
  try {
    // The tag lives in the APP1 segment near the front of a JPEG.
    const head = new DataView(await file.slice(0, 128 * 1024).arrayBuffer());
    if (head.byteLength < 4 || head.getUint16(0) !== 0xffd8) return null; // not JPEG

    let off = 2;
    while (off + 4 < head.byteLength) {
      if (head.getUint16(off) !== 0xffe1) {
        // Skip to the next marker segment.
        const size = head.getUint16(off + 2);
        if (size <= 0) return null;
        off += 2 + size;
        continue;
      }
      const app1 = off + 4;
      if (head.getUint32(app1) !== 0x45786966) return null; // "Exif"

      const tiff = app1 + 6;
      const little = head.getUint16(tiff) === 0x4949;
      const ifd0 = tiff + head.getUint32(tiff + 4, little);

      // Walk IFD0 for the Exif sub-IFD pointer (0x8769), then that for
      // DateTimeOriginal (0x9003).
      const walk = (dir: number, want: number): number | null => {
        const n = head.getUint16(dir, little);
        for (let i = 0; i < n; i += 1) {
          const e = dir + 2 + i * 12;
          if (head.getUint16(e, little) === want) return head.getUint32(e + 8, little);
        }
        return null;
      };

      const exifPtr = walk(ifd0, 0x8769);
      if (exifPtr === null) return null;
      const dtOff = walk(tiff + exifPtr, 0x9003);
      if (dtOff === null) return null;

      // "YYYY:MM:DD HH:MM:SS", 19 ASCII bytes.
      let s = '';
      for (let i = 0; i < 19; i += 1) s += String.fromCharCode(head.getUint8(tiff + dtOff + i));
      const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
      if (!m) return null;
      // EXIF timestamps carry no zone. Read as local, which is right for a
      // phone photographing a road in the city it is standing in.
      const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch {
    return null;
  }
}

export class PhotoError extends Error {}

function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap handles orientation correctly on modern browsers and
  // avoids a decode round trip through the DOM.
  if ('createImageBitmap' in window) {
    return createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoError('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

/** Downscale to at most MAX_EDGE on the long side and re-encode as JPEG. */
export async function preparePhoto(
  file: File | Blob,
  fromCamera = false,
): Promise<PreparedPhoto> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new PhotoError('That image is too large. Try taking a new photo.');
  }
  if (file.type && !file.type.startsWith('image/')) {
    throw new PhotoError('Only photos can be attached to a report.');
  }

  // Lifted before the canvas re-encode below discards every tag.
  const takenAt = await readTakenAt(file);

  const source = await loadBitmap(file);
  const sw = 'width' in source ? source.width : 0;
  const sh = 'height' in source ? source.height : 0;
  if (!sw || !sh) throw new PhotoError('That image could not be decoded.');

  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError('This browser cannot process the photo.');

  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  if ('close' in source) source.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  if (!blob) throw new PhotoError('The photo could not be prepared for upload.');

  return { blob, width: w, height: h, bytes: blob.size, taken_at: takenAt, from_camera: fromCamera };
}

/** An object URL for previewing, which the caller must revoke. */
export function previewUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
