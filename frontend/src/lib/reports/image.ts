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
export async function preparePhoto(file: File | Blob): Promise<PreparedPhoto> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new PhotoError('That image is too large. Try taking a new photo.');
  }
  if (file.type && !file.type.startsWith('image/')) {
    throw new PhotoError('Only photos can be attached to a report.');
  }

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

  return { blob, width: w, height: h, bytes: blob.size };
}

/** An object URL for previewing, which the caller must revoke. */
export function previewUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}
