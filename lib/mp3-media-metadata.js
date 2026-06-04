const fs = require('fs');
const path = require('path');

const MPEG_BITRATES = {
  V1L1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  V1L2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  V1L3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  V2L1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  V2L2L3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

const MPEG_SAMPLE_RATES = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

function readSynchsafeInt(buffer, offset) {
  return (
    ((buffer[offset] & 0x7f) << 21) |
    ((buffer[offset + 1] & 0x7f) << 14) |
    ((buffer[offset + 2] & 0x7f) << 7) |
    (buffer[offset + 3] & 0x7f)
  );
}

function getId3TagEnd(buffer) {
  if (buffer.length < 10 || buffer.toString('latin1', 0, 3) !== 'ID3') {
    return 0;
  }

  return Math.min(buffer.length, 10 + readSynchsafeInt(buffer, 6));
}

function getId3FrameStart(buffer, tagEnd) {
  const majorVersion = buffer[3];
  const flags = buffer[5];
  const hasExtendedHeader = (flags & 0x40) !== 0;
  if (!hasExtendedHeader) {
    return 10;
  }

  if (majorVersion === 3 && buffer.length >= 14) {
    return Math.min(tagEnd, 10 + 4 + buffer.readUInt32BE(10));
  }

  if (majorVersion === 4 && buffer.length >= 14) {
    return Math.min(tagEnd, 10 + readSynchsafeInt(buffer, 10));
  }

  return 10;
}

function decodeTextFrame(body) {
  if (body.length === 0) {
    return '';
  }

  const encoding = body[0];
  const content = body.subarray(1);
  if (encoding === 1 || encoding === 2) {
    return content.toString('utf16le').replace(/\0+$/, '').trim();
  }
  if (encoding === 3) {
    return content.toString('utf8').replace(/\0+$/, '').trim();
  }
  return content.toString('latin1').replace(/\0+$/, '').trim();
}

function splitEncodedTextValues(body) {
  if (body.length === 0) {
    return [];
  }

  const encoding = body[0];
  const content = body.subarray(1);
  if (encoding === 1 || encoding === 2) {
    return content
      .toString('utf16le')
      .split('\u0000')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  const charset = encoding === 3 ? 'utf8' : 'latin1';
  return content
    .toString(charset)
    .split('\u0000')
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseBpm(value) {
  const match = String(value).match(/\d+(?:\.\d+)?/);
  if (!match) {
    return undefined;
  }

  const bpm = Number.parseFloat(match[0]);
  return Number.isFinite(bpm) ? bpm : undefined;
}

function extractBpmFromId3(buffer) {
  const tagEnd = getId3TagEnd(buffer);
  if (tagEnd === 0) {
    return undefined;
  }

  const majorVersion = buffer[3];
  let offset = getId3FrameStart(buffer, tagEnd);
  while (offset < tagEnd) {
    const isV22 = majorVersion === 2;
    const headerSize = isV22 ? 6 : 10;
    const idLength = isV22 ? 3 : 4;
    if (offset + headerSize > tagEnd) {
      break;
    }

    const frameId = buffer.toString('latin1', offset, offset + idLength);
    if (!/^[A-Z0-9]+$/.test(frameId)) {
      break;
    }

    const frameSize = isV22
      ? (buffer[offset + 3] << 16) | (buffer[offset + 4] << 8) | buffer[offset + 5]
      : majorVersion === 4
        ? readSynchsafeInt(buffer, offset + 4)
        : buffer.readUInt32BE(offset + 4);

    if (frameSize <= 0 || offset + headerSize + frameSize > tagEnd) {
      break;
    }

    const body = buffer.subarray(offset + headerSize, offset + headerSize + frameSize);
    if (frameId === 'TBPM' || frameId === 'TBP') {
      return parseBpm(decodeTextFrame(body));
    }
    if (frameId === 'TXXX') {
      const values = splitEncodedTextValues(body);
      const description = (values[0] || '').toLowerCase();
      if (description === 'bpm' || description === 'tempo') {
        return parseBpm(values[1]);
      }
    }

    offset += headerSize + frameSize;
  }

  return undefined;
}

function parseFrameHeader(buffer, offset) {
  if (offset + 4 > buffer.length || buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) {
    return null;
  }

  const versionBits = (buffer[offset + 1] >> 3) & 0x03;
  const layerBits = (buffer[offset + 1] >> 1) & 0x03;
  const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03;
  const padding = (buffer[offset + 2] >> 1) & 0x01;

  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return null;
  }

  const isMpeg1 = versionBits === 3;
  const isLayer1 = layerBits === 3;
  const isLayer2 = layerBits === 2;
  const bitrateKey = isMpeg1
    ? isLayer1
      ? 'V1L1'
      : isLayer2
        ? 'V1L2'
        : 'V1L3'
    : isLayer1
      ? 'V2L1'
      : 'V2L2L3';
  const bitrate = MPEG_BITRATES[bitrateKey][bitrateIndex] * 1000;
  const sampleRate = MPEG_SAMPLE_RATES[versionBits][sampleRateIndex];
  const samplesPerFrame = isLayer1 ? 384 : isMpeg1 ? 1152 : layerBits === 1 ? 576 : 1152;
  const frameLength = isLayer1
    ? Math.floor((12 * bitrate / sampleRate + padding) * 4)
    : Math.floor((samplesPerFrame / 8) * bitrate / sampleRate + padding);

  if (!Number.isFinite(frameLength) || frameLength <= 4) {
    return null;
  }

  return {
    frameLength,
    samplesPerFrame,
    sampleRate,
  };
}

function extractDurationFromMpegFrames(buffer) {
  let offset = getId3TagEnd(buffer);
  let samples = 0;
  let sampleRate = 0;
  let frames = 0;

  while (offset + 4 <= buffer.length) {
    const frame = parseFrameHeader(buffer, offset);
    if (!frame) {
      offset += 1;
      continue;
    }

    samples += frame.samplesPerFrame;
    sampleRate = frame.sampleRate;
    frames += 1;
    offset += frame.frameLength;
  }

  if (frames === 0 || sampleRate === 0) {
    return undefined;
  }

  return Number((samples / sampleRate).toFixed(3));
}

function extractMediaMetadataFromBuffer(buffer) {
  const duration = extractDurationFromMpegFrames(buffer);
  const bpm = extractBpmFromId3(buffer);
  const metadata = {};

  if (duration !== undefined) {
    metadata.duration = duration;
  }
  if (bpm !== undefined) {
    metadata.bpm = bpm;
  }

  return metadata;
}

function extractMediaMetadataFromFile(filePath) {
  return extractMediaMetadataFromBuffer(fs.readFileSync(filePath));
}

function getMetadataFilePath({ item, metadataFilePath }) {
  if (metadataFilePath) {
    return metadataFilePath;
  }
  if (item && item.metadataFilePath) {
    return item.metadataFilePath;
  }
  if (item && item.filePath) {
    return path.join(path.dirname(item.filePath), 'metadata.json');
  }
  throw new Error('metadata.json path is unavailable.');
}

function writeMediaMetadataJson(options) {
  const fsModule = options.fs || fs;
  const filePath = getMetadataFilePath(options);
  const existing = JSON.parse(fsModule.readFileSync(filePath, 'utf8') || '{}');
  const next = { ...existing };

  if (options.metadata.duration !== undefined) {
    next.duration = options.metadata.duration;
  }
  if (options.metadata.bpm !== undefined) {
    next.bpm = options.metadata.bpm;
  }
  if (options.metadata.customThumbnail !== undefined) {
    next.customThumbnail = options.metadata.customThumbnail;
  }

  fsModule.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

module.exports = {
  extractMediaMetadataFromBuffer,
  extractMediaMetadataFromFile,
  writeMediaMetadataJson,
};
