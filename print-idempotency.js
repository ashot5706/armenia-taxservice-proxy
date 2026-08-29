const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const fileDescriptor = fs.openSync(temporaryPath, 'w', 0o600);
  try {
    fs.writeFileSync(fileDescriptor, JSON.stringify(value, null, 2));
    fs.fsyncSync(fileDescriptor);
  } finally {
    fs.closeSync(fileDescriptor);
  }
  fs.renameSync(temporaryPath, filePath);

  const directoryDescriptor = fs.openSync(path.dirname(filePath), 'r');
  try {
    fs.fsyncSync(directoryDescriptor);
  } finally {
    fs.closeSync(directoryDescriptor);
  }
}

function requestHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

class PrintIdempotencyStore {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  pathFor(key) {
    const fileName = crypto.createHash('sha256').update(key).digest('hex');
    return path.join(this.directory, `${fileName}.json`);
  }

  lockPathFor(key) {
    const fileName = crypto.createHash('sha256').update(key).digest('hex');
    return path.join(this.directory, `${fileName}.lock`);
  }

  read(key) {
    try {
      return JSON.parse(fs.readFileSync(this.pathFor(key), 'utf8'));
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  begin(key, body) {
    const hash = requestHash(body);
    const filePath = this.pathFor(key);
    const lockPath = this.lockPathFor(key);
    const pending = {
      key,
      requestHash: hash,
      state: 'pending',
      attemptCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(lockPath, `${process.pid}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (error && error.code === 'EEXIST') return { kind: 'uncertain' };
      throw error;
    }

    try {
      const existing = this.read(key);
      if (!existing) {
        atomicWriteJson(filePath, pending);
        return { kind: 'acquired', requestHash: hash };
      }
      if (existing.requestHash !== hash) {
        return { kind: 'conflict' };
      }
      if (existing.state === 'completed') {
        return { kind: 'replay', response: existing.response };
      }
      return { kind: 'uncertain' };
    } finally {
      try {
        fs.unlinkSync(lockPath);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
      }
    }
  }

  complete(key, hash, response) {
    const existing = this.read(key);
    if (!existing || existing.requestHash !== hash) {
      throw new Error('Idempotency marker is missing or does not match the request');
    }
    atomicWriteJson(this.pathFor(key), {
      ...existing,
      state: 'completed',
      response,
      updatedAt: new Date().toISOString(),
    });
  }

}

module.exports = { PrintIdempotencyStore, requestHash };
