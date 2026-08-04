import { existsSync } from 'node:fs';

const configured = process.env.BLENDER_BIN ? [process.env.BLENDER_BIN] : [];
const platformDefaults =
  process.platform === 'darwin'
    ? [
        '/Applications/Blender.app/Contents/MacOS/Blender',
        '/Applications/Blender 2.app/Contents/MacOS/Blender',
      ]
    : process.platform === 'win32'
      ? []
      : ['/usr/bin/blender', '/usr/local/bin/blender'];

export function findBlenderBinaries() {
  return [...new Set([...configured, ...platformDefaults])].filter((candidate) =>
    existsSync(candidate),
  );
}

export function requireBlenderBinaries() {
  const binaries = findBlenderBinaries();
  if (binaries.length === 0) {
    throw new Error('Blender not found. Set BLENDER_BIN to the Blender executable path.');
  }
  return binaries;
}
