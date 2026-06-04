const path = require('path');
const os = require('os');
const fs = require('fs');
const { extractCoverArtFromFile } = require('./id3-cover');
const {
  extractMediaMetadataFromFile,
  writeMediaMetadataJson,
} = require('./mp3-media-metadata');

function extensionForMime(mime) {
  if (mime === 'image/png') {
    return 'png';
  }
  if (mime === 'image/webp') {
    return 'webp';
  }
  return 'jpg';
}

function isMp3Item(item) {
  return String(item.ext || '').toLowerCase() === 'mp3';
}

async function getTargetItems(eagle, mode) {
  if (mode === 'all') {
    return eagle.item.get({ ext: 'mp3' });
  }

  const selected = await eagle.item.getSelected();
  return selected.filter(isMp3Item);
}

async function applyMp3CoverThumbnails(options) {
  const {
    eagle,
    mode,
    tempDir = path.join(os.tmpdir(), 'eagle-mp3-cover-thumbnail'),
    fs: fsModule = fs,
    extractCoverArtFromFile: extract = extractCoverArtFromFile,
    extractMediaMetadataFromFile: extractMetadata = extractMediaMetadataFromFile,
    writeMediaMetadataJson: writeMetadata = writeMediaMetadataJson,
    onProgress,
    shouldStop,
  } = options;

  fsModule.mkdirSync(tempDir, { recursive: true });

  const items = await getTargetItems(eagle, mode);
  const result = {
    total: items.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    metadataUpdated: 0,
    metadataFailed: 0,
    cancelled: false,
    errors: [],
  };

  for (let index = 0; index < items.length; index += 1) {
    if (shouldStop && shouldStop()) {
      result.cancelled = true;
      break;
    }

    const item = items[index];
    try {
      const cover = extract(item.filePath);
      const extension = extensionForMime(cover.mime);
      const thumbnailPath = path.join(tempDir, `${item.id}.${extension}`);

      fsModule.writeFileSync(thumbnailPath, cover.data);
      await item.setCustomThumbnail(thumbnailPath);

      try {
        const mediaMetadata = extractMetadata(item.filePath);
        writeMetadata({
          item,
          metadata: {
            ...mediaMetadata,
            customThumbnail: true,
          },
          fs: fsModule,
        });
        result.metadataUpdated += 1;
      } catch (error) {
        result.metadataFailed += 1;
        result.errors.push({
          id: item.id,
          name: item.name || item.filePath || item.id,
          message: `Metadata update failed: ${error && error.message ? error.message : String(error)}`,
        });
      }

      result.succeeded += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        id: item.id,
        name: item.name || item.filePath || item.id,
        message: error && error.message ? error.message : String(error),
      });
    }

    result.processed += 1;

    if (onProgress) {
      onProgress({
        current: index + 1,
        total: items.length,
        item,
        result,
      });
    }

    if (shouldStop && shouldStop()) {
      result.cancelled = true;
      break;
    }
  }

  return result;
}

module.exports = {
  applyMp3CoverThumbnails,
  extensionForMime,
};
