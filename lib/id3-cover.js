const fs = require('fs');

const PICTURE_TYPE_FRONT_COVER = 3;

function readSynchsafeInt(buffer, offset) {
  return (
    ((buffer[offset] & 0x7f) << 21) |
    ((buffer[offset + 1] & 0x7f) << 14) |
    ((buffer[offset + 2] & 0x7f) << 7) |
    (buffer[offset + 3] & 0x7f)
  );
}

function readUInt24BE(buffer, offset) {
  return (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
}

function getFrameStartOffset(buffer, majorVersion, flags, tagEnd) {
  const hasExtendedHeader = (flags & 0x40) !== 0;
  if (!hasExtendedHeader) {
    return 10;
  }

  if (majorVersion === 3 && buffer.length >= 14) {
    const extendedHeaderSize = buffer.readUInt32BE(10);
    return Math.min(tagEnd, 10 + 4 + extendedHeaderSize);
  }

  if (majorVersion === 4 && buffer.length >= 14) {
    const extendedHeaderSize = readSynchsafeInt(buffer, 10);
    return Math.min(tagEnd, 10 + extendedHeaderSize);
  }

  return 10;
}

function findStringTerminator(buffer, offset, encoding) {
  if (encoding === 0 || encoding === 3) {
    const index = buffer.indexOf(0x00, offset);
    return index === -1 ? buffer.length : index;
  }

  for (let index = offset; index < buffer.length - 1; index += 2) {
    if (buffer[index] === 0x00 && buffer[index + 1] === 0x00) {
      return index;
    }
  }
  return buffer.length;
}

function skipEncodedString(buffer, offset, encoding) {
  const terminator = findStringTerminator(buffer, offset, encoding);
  return terminator + (encoding === 0 || encoding === 3 ? 1 : 2);
}

function parseApicFrame(frameBody) {
  if (frameBody.length < 5) {
    return null;
  }

  const encoding = frameBody[0];
  const mimeEnd = frameBody.indexOf(0x00, 1);
  if (mimeEnd === -1 || mimeEnd + 2 > frameBody.length) {
    return null;
  }

  const mime = frameBody.toString('latin1', 1, mimeEnd).toLowerCase();
  const pictureType = frameBody[mimeEnd + 1];
  const imageOffset = skipEncodedString(frameBody, mimeEnd + 2, encoding);
  if (imageOffset >= frameBody.length) {
    return null;
  }

  const data = frameBody.subarray(imageOffset);
  return {
    mime,
    pictureType,
    data,
    size: readImageSize(data),
  };
}

function parsePicFrame(frameBody) {
  if (frameBody.length < 6) {
    return null;
  }

  const encoding = frameBody[0];
  const format = frameBody.toString('latin1', 1, 4).toLowerCase();
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const pictureType = frameBody[4];
  const imageOffset = skipEncodedString(frameBody, 5, encoding);
  if (imageOffset >= frameBody.length) {
    return null;
  }

  const data = frameBody.subarray(imageOffset);
  return {
    mime,
    pictureType,
    data,
    size: readImageSize(data),
  };
}

function parseId3v2Frames(buffer) {
  if (buffer.length < 10 || buffer.toString('latin1', 0, 3) !== 'ID3') {
    throw new Error('The file does not contain an ID3v2 tag.');
  }

  const majorVersion = buffer[3];
  const flags = buffer[5];
  const tagSize = readSynchsafeInt(buffer, 6);
  const tagEnd = Math.min(buffer.length, 10 + tagSize);
  const pictures = [];

  let offset = getFrameStartOffset(buffer, majorVersion, flags, tagEnd);
  while (offset < tagEnd) {
    const isV22 = majorVersion === 2;
    const headerSize = isV22 ? 6 : 10;
    if (offset + headerSize > tagEnd) {
      break;
    }

    const idLength = isV22 ? 3 : 4;
    const frameId = buffer.toString('latin1', offset, offset + idLength);
    if (!/^[A-Z0-9]+$/.test(frameId)) {
      break;
    }

    const frameSize = isV22
      ? readUInt24BE(buffer, offset + 3)
      : majorVersion === 4
        ? readSynchsafeInt(buffer, offset + 4)
        : buffer.readUInt32BE(offset + 4);

    if (frameSize <= 0 || offset + headerSize + frameSize > tagEnd) {
      break;
    }

    const bodyStart = offset + headerSize;
    const body = buffer.subarray(bodyStart, bodyStart + frameSize);
    const picture = frameId === 'APIC'
      ? parseApicFrame(body)
      : frameId === 'PIC'
        ? parsePicFrame(body)
        : null;

    if (picture) {
      pictures.push(picture);
    }

    offset = bodyStart + frameSize;
  }

  return pictures;
}

function extractCoverArtFromBuffer(buffer) {
  const pictures = parseId3v2Frames(buffer);
  const cover = pictures.find((picture) => picture.pictureType === PICTURE_TYPE_FRONT_COVER)
    || pictures[0];

  if (!cover) {
    throw new Error('No embedded MP3 artwork found.');
  }

  return cover;
}

function extractCoverArtFromFile(filePath) {
  return extractCoverArtFromBuffer(fs.readFileSync(filePath));
}

function readImageSize(buffer) {
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      const isStartOfFrame = (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      );

      if (isStartOfFrame && offset + 8 < buffer.length) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
        };
      }

      offset += 2 + length;
    }
  }

  return { width: 0, height: 0 };
}

module.exports = {
  extractCoverArtFromBuffer,
  extractCoverArtFromFile,
  readImageSize,
};
