const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractMediaMetadataFromBuffer,
  writeMediaMetadataJson,
} = require('../lib/mp3-media-metadata');

function synchsafe(size) {
  return Buffer.from([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
}

function textFrame(id, value) {
  const body = Buffer.concat([Buffer.from([0x03]), Buffer.from(value, 'utf8')]);
  const header = Buffer.alloc(10);
  header.write(id, 0, 4, 'latin1');
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function txxxFrame(description, value) {
  const body = Buffer.concat([
    Buffer.from([0x03]),
    Buffer.from(description, 'utf8'),
    Buffer.from([0x00]),
    Buffer.from(value, 'utf8'),
  ]);
  const header = Buffer.alloc(10);
  header.write('TXXX', 0, 4, 'latin1');
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

function mpegFrame() {
  const frame = Buffer.alloc(417, 0);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x64;
  return frame;
}

test('extracts duration and BPM from an MP3 buffer', () => {
  const frames = Array.from({ length: 100 }, mpegFrame);
  const mp3 = Buffer.concat([
    id3v23([textFrame('TBPM', '135.837')]),
    ...frames,
  ]);

  const metadata = extractMediaMetadataFromBuffer(mp3);

  assert.equal(metadata.bpm, 135.837);
  assert.equal(metadata.duration, 2.612);
});

test('extracts BPM from ID3v2.3 tags with an extended header', () => {
  const mp3 = Buffer.concat([
    id3v23WithExtendedHeader([textFrame('TBPM', '135.837')]),
    mpegFrame(),
  ]);

  assert.equal(extractMediaMetadataFromBuffer(mp3).bpm, 135.837);
});

test('extracts BPM from a TXXX BPM frame', () => {
  const mp3 = Buffer.concat([
    id3v23([txxxFrame('BPM', '135.837')]),
    mpegFrame(),
  ]);

  assert.equal(extractMediaMetadataFromBuffer(mp3).bpm, 135.837);
});

test('writes duration and BPM into existing metadata JSON without removing other fields', () => {
  const files = new Map([
    ['/library/item.info/metadata.json', JSON.stringify({ name: 'Track', tags: ['mp3'] }, null, 2)],
  ]);
  const fsMock = {
    readFileSync(filePath) {
      return files.get(filePath);
    },
    writeFileSync(filePath, content) {
      files.set(filePath, content);
    },
  };

  writeMediaMetadataJson({
    metadataFilePath: '/library/item.info/metadata.json',
    metadata: { duration: 1217.664, bpm: 135.837, customThumbnail: true },
    fs: fsMock,
  });

  assert.deepEqual(JSON.parse(files.get('/library/item.info/metadata.json')), {
    name: 'Track',
    tags: ['mp3'],
    duration: 1217.664,
    bpm: 135.837,
    customThumbnail: true,
  });
});

test('infers metadata JSON path from item filePath when metadataFilePath is missing', () => {
  const files = new Map([
    ['/library/item.info/metadata.json', '{}'],
  ]);
  const fsMock = {
    readFileSync(filePath) {
      return files.get(filePath);
    },
    writeFileSync(filePath, content) {
      files.set(filePath, content);
    },
  };

  writeMediaMetadataJson({
    item: { filePath: '/library/item.info/audio.mp3' },
    metadata: { duration: 10 },
    fs: fsMock,
  });

  assert.equal(JSON.parse(files.get('/library/item.info/metadata.json')).duration, 10);
});
