const fs = require('fs');
const { extractCoverArtFromFile } = require('../lib/id3-cover');
const { extractMediaMetadataFromFile } = require('../lib/mp3-media-metadata');

module.exports = async ({ src, dest, item }) => {
  const cover = extractCoverArtFromFile(src);
  const mediaMetadata = extractMediaMetadataFromFile(src);

  fs.writeFileSync(dest, cover.data);

  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    throw new Error('MP3 cover thumbnail generation failed.');
  }

  if (cover.size.width > 0) {
    item.width = cover.size.width;
  }
  if (cover.size.height > 0) {
    item.height = cover.size.height;
  }
  if (mediaMetadata.duration !== undefined) {
    item.duration = mediaMetadata.duration;
  }
  if (mediaMetadata.bpm !== undefined) {
    item.bpm = mediaMetadata.bpm;
  }
  item.customThumbnail = true;

  return item;
};
