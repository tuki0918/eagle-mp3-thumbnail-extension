const assert = require('node:assert/strict');
const test = require('node:test');

const { extractCoverArtFromBuffer, readImageSize } = require('../lib/id3-cover');

function synchsafe(size) {
  return Buffer.from([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
}

function png(width, height) {
  const data = Buffer.alloc(24);
  data.writeUInt32BE(0x89504e47, 0);
  data.writeUInt32BE(0x0d0a1a0a, 4);
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function jpeg(width, height) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11,
    0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

function apicFrame({ mime, type, description = '', image }) {
  const body = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from(mime, 'latin1'),
    Buffer.from([0x00, type]),
    Buffer.from(description, 'latin1'),
    Buffer.from([0x00]),
    image,
  ]);
  const header = Buffer.alloc(10);
  header.write('APIC', 0, 4, 'latin1');
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function id3v23(frames) {
  const body = Buffer.concat(frames);
  return Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([0x03, 0x00, 0x00]),
    synchsafe(body.length),
    body,
  ]);
}

function id3v23WithExtendedHeader(frames) {
  const extendedHeader = Buffer.alloc(10);
  extendedHeader.writeUInt32BE(6, 0);
  const body = Buffer.concat([extendedHeader, ...frames]);
  return Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([0x03, 0x00, 0x40]),
    synchsafe(body.length),
    body,
  ]);
}

test('extracts an ID3v2.3 APIC cover image', () => {
  const image = png(600, 600);
  const mp3 = id3v23([apicFrame({ mime: 'image/png', type: 3, image })]);

  const cover = extractCoverArtFromBuffer(mp3);

  assert.equal(cover.mime, 'image/png');
  assert.equal(cover.pictureType, 3);
  assert.deepEqual(cover.data, image);
  assert.deepEqual(cover.size, { width: 600, height: 600 });
});

test('prefers front cover artwork when multiple APIC frames exist', () => {
  const other = jpeg(320, 240);
  const front = png(800, 800);
  const mp3 = id3v23([
    apicFrame({ mime: 'image/jpeg', type: 0, image: other }),
    apicFrame({ mime: 'image/png', type: 3, image: front }),
  ]);

  const cover = extractCoverArtFromBuffer(mp3);

  assert.equal(cover.mime, 'image/png');
  assert.equal(cover.pictureType, 3);
  assert.deepEqual(cover.data, front);
});

test('extracts cover images from ID3v2.3 tags with an extended header', () => {
  const image = png(700, 700);
  const mp3 = id3v23WithExtendedHeader([
    apicFrame({ mime: 'image/png', type: 3, image }),
  ]);

  const cover = extractCoverArtFromBuffer(mp3);

  assert.equal(cover.mime, 'image/png');
  assert.deepEqual(cover.data, image);
});

test('reads JPEG dimensions from cover bytes', () => {
  assert.deepEqual(readImageSize(jpeg(1024, 768)), { width: 1024, height: 768 });
});

test('throws when an MP3 does not contain embedded artwork', () => {
  const empty = id3v23([]);

  assert.throws(
    () => extractCoverArtFromBuffer(empty),
    /No embedded MP3 artwork found/
  );
});
