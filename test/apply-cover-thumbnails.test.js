const assert = require('node:assert/strict');
const test = require('node:test');

const { applyMp3CoverThumbnails } = require('../lib/apply-cover-thumbnails');

function createFsMock() {
  const writes = [];
  return {
    writes,
    mkdirSync(path, options) {
      this.mkdirCall = { path, options };
    },
    writeFileSync(path, data) {
      writes.push({ path, data });
    },
  };
}

function createItem({ id, ext = 'mp3', filePath = `/music/${id}.mp3`, metadataFilePath, fail = false }) {
  return {
    id,
    ext,
    filePath,
    metadataFilePath,
    thumbnailPath: `/thumbs/${id}.png`,
    async setCustomThumbnail(path) {
      this.receivedThumbnailPath = path;
      if (fail) {
        throw new Error('set failed');
      }
      return true;
    },
  };
}

test('applies cover thumbnails to selected MP3 items only', async () => {
  const fsMock = createFsMock();
  const first = createItem({ id: 'one' });
  const second = createItem({ id: 'two', ext: 'jpg' });
  const eagle = {
    item: {
      async getSelected() {
        return [first, second];
      },
    },
  };

  const result = await applyMp3CoverThumbnails({
    eagle,
    mode: 'selected',
    tempDir: '/tmp/eagle-covers',
    fs: fsMock,
    extractCoverArtFromFile(filePath) {
      return { mime: 'image/png', data: Buffer.from(`cover:${filePath}`) };
    },
    extractMediaMetadataFromFile() {
      return {};
    },
    writeMediaMetadataJson() {},
  });

  assert.equal(result.total, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.equal(first.receivedThumbnailPath, '/tmp/eagle-covers/one.png');
  assert.equal(second.receivedThumbnailPath, undefined);
  assert.deepEqual(fsMock.writes, [
    { path: '/tmp/eagle-covers/one.png', data: Buffer.from('cover:/music/one.mp3') },
  ]);
});

test('fetches all MP3 items for all mode', async () => {
  const fsMock = createFsMock();
  const item = createItem({ id: 'album' });
  let query;
  const eagle = {
    item: {
      async get(options) {
        query = options;
        return [item];
      },
    },
  };

  const result = await applyMp3CoverThumbnails({
    eagle,
    mode: 'all',
    tempDir: '/tmp/eagle-covers',
    fs: fsMock,
    extractCoverArtFromFile() {
      return { mime: 'image/jpeg', data: Buffer.from('jpeg bytes') };
    },
    extractMediaMetadataFromFile() {
      return {};
    },
    writeMediaMetadataJson() {},
  });

  assert.deepEqual(query, { ext: 'mp3' });
  assert.equal(result.total, 1);
  assert.equal(item.receivedThumbnailPath, '/tmp/eagle-covers/album.jpg');
});

test('continues after item failures and reports errors', async () => {
  const fsMock = createFsMock();
  const ok = createItem({ id: 'ok' });
  const bad = createItem({ id: 'bad', fail: true });
  const eagle = {
    item: {
      async getSelected() {
        return [bad, ok];
      },
    },
  };

  const result = await applyMp3CoverThumbnails({
    eagle,
    mode: 'selected',
    tempDir: '/tmp/eagle-covers',
    fs: fsMock,
    extractCoverArtFromFile(filePath) {
      return { mime: 'image/png', data: Buffer.from(filePath) };
    },
    extractMediaMetadataFromFile() {
      return {};
    },
    writeMediaMetadataJson() {},
  });

  assert.equal(result.total, 2);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, 'bad');
  assert.match(result.errors[0].message, /set failed/);
  assert.equal(ok.receivedThumbnailPath, '/tmp/eagle-covers/ok.png');
});

test('writes duration and BPM metadata for processed MP3 items', async () => {
  const fsMock = createFsMock();
  const item = createItem({
    id: 'track',
    metadataFilePath: '/library/track.info/metadata.json',
  });
  const writtenMetadata = [];
  const eagle = {
    item: {
      async getSelected() {
        return [item];
      },
    },
  };

  const result = await applyMp3CoverThumbnails({
    eagle,
    mode: 'selected',
    tempDir: '/tmp/eagle-covers',
    fs: fsMock,
    extractCoverArtFromFile() {
      return { mime: 'image/png', data: Buffer.from('cover') };
    },
    extractMediaMetadataFromFile() {
      return { duration: 1217.664, bpm: 135.837 };
    },
    writeMediaMetadataJson(options) {
      writtenMetadata.push(options);
    },
  });

  assert.equal(result.succeeded, 1);
  assert.equal(result.metadataUpdated, 1);
  assert.equal(writtenMetadata.length, 1);
  assert.equal(writtenMetadata[0].item, item);
  assert.deepEqual(writtenMetadata[0].metadata, {
    duration: 1217.664,
    bpm: 135.837,
    customThumbnail: true,
  });
});

test('writes customThumbnail even when duration and BPM are unavailable', async () => {
  const fsMock = createFsMock();
  const item = createItem({
    id: 'art-only',
    metadataFilePath: '/library/art-only.info/metadata.json',
  });
  const writtenMetadata = [];
  const eagle = {
    item: {
      async getSelected() {
        return [item];
      },
    },
  };

  await applyMp3CoverThumbnails({
    eagle,
    mode: 'selected',
    tempDir: '/tmp/eagle-covers',
    fs: fsMock,
    extractCoverArtFromFile() {
      return { mime: 'image/png', data: Buffer.from('cover') };
    },
    extractMediaMetadataFromFile() {
      return {};
    },
    writeMediaMetadataJson(options) {
      writtenMetadata.push(options);
    },
  });

  assert.deepEqual(writtenMetadata[0].metadata, { customThumbnail: true });
});

test('stops before the next loop when cancellation is requested', async () => {
  const fsMock = createFsMock();
  const first = createItem({ id: 'first' });
  const second = createItem({ id: 'second' });
  const eagle = {
    item: {
      async getSelected() {
        return [first, second];
      },
    },
  };
  let shouldStop = false;

  const result = await applyMp3CoverThumbnails({
    eagle,
    mode: 'selected',
    tempDir: '/tmp/eagle-covers',
    fs: fsMock,
    extractCoverArtFromFile() {
      return { mime: 'image/png', data: Buffer.from('cover') };
    },
    extractMediaMetadataFromFile() {
      return {};
    },
    writeMediaMetadataJson() {},
    onProgress() {
      shouldStop = true;
    },
    shouldStop() {
      return shouldStop;
    },
  });

  assert.equal(result.cancelled, true);
  assert.equal(result.processed, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(second.receivedThumbnailPath, undefined);
});
