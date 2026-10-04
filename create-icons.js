// Script to generate valid PNG icons using Node's built-in zlib
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height, colorFn) {
  const rowSize = width * 4 + 1; // 1 filter byte per row + RGBA
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = colorFn(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 4;
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth
  ihdrData[9] = 6; // Color type: RGBA
  ihdrData[10] = 0; // Compression method
  ihdrData[11] = 0; // Filter method
  ihdrData[12] = 0; // Interlace method
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // IDAT chunk
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(8 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

// CRC32 calculation table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Generate icon color with rounded squircle and briefcase/calendar gradient
function iconColor(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;
  const cx = 0.5;
  const cy = 0.5;
  const dx = Math.abs(nx - cx);
  const dy = Math.abs(ny - cy);
  const r = 0.44;

  // Squircle background corner radius
  const corner = Math.pow(Math.max(0, dx - 0.25), 2) + Math.pow(Math.max(0, dy - 0.25), 2);
  if (corner > 0.05) {
    return [0, 0, 0, 0]; // Transparent outside
  }

  // Gradient background: Indigo (79, 70, 229) to Violet (139, 92, 246)
  let bgR = Math.round(79 + (139 - 79) * ny);
  let bgG = Math.round(70 + (92 - 70) * ny);
  let bgB = Math.round(229 + (246 - 229) * nx);

  // Inner glyph: Clock / Hourglass / Envelope motif
  // Calendar base in center
  const calLeft = 0.24, calRight = 0.76, calTop = 0.28, calBottom = 0.74;
  if (nx >= calLeft && nx <= calRight && ny >= calTop && ny <= calBottom) {
    // Top banner of calendar (Coral / Red #EF4444)
    if (ny <= calTop + 0.12) {
      return [239, 68, 68, 255];
    }
    // Calendar body (White)
    if (nx > calLeft + 0.04 && nx < calRight - 0.04 && ny > calTop + 0.14 && ny < calBottom - 0.04) {
      // Clock or alert dot inside
      const dotDx = nx - 0.5;
      const dotDy = ny - 0.46;
      if (Math.hypot(dotDx, dotDy) < 0.12) {
        // Clock ring or deadline dot
        if (Math.hypot(dotDx, dotDy) > 0.07) return [79, 70, 229, 255];
        // Clock hands
        if (Math.abs(dotDx) < 0.018 && dotDy <= 0.01) return [79, 70, 229, 255];
        if (Math.abs(dotDy) < 0.018 && dotDx >= -0.01) return [79, 70, 229, 255];
      }
      return [255, 255, 255, 255];
    }
    return [220, 225, 235, 255];
  }

  // Ring binders on top
  if ((Math.abs(nx - 0.38) < 0.03 || Math.abs(nx - 0.62) < 0.03) && ny >= 0.22 && ny <= 0.32) {
    return [243, 244, 246, 255];
  }

  return [bgR, bgG, bgB, 255];
}

const iconsDir = path.join(__dirname, 'icons');
[16, 48, 128].forEach(size => {
  const pngBuf = createPng(size, size, iconColor);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), pngBuf);
  console.log(`Generated icon${size}.png (${size}x${size})`);
});
