import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function isExcludedPath(relPath) {
  const norm = relPath.replace(/\\/g, '/');

  if (norm === '.credentials.yaml' || norm.endsWith('/.credentials.yaml')) return true;
  if (norm.includes('node_modules')) return true;
  if (norm === 'android/app-layer.patch.yml') return true;
  if (norm === 'android/budget.json') return true;
  if (norm === 'android/boot-journal.json') return true;
  if (norm === 'android/pnpm-report.jsonl') return true;
  if (norm.startsWith('logs/') || norm.includes('/logs/')) return true;
  if (norm.startsWith('storages/session_projcache/') || norm.includes('/storages/session_projcache/')) return true;
  if (norm.endsWith('session.lock')) return true;

  return false;
}

export function atomicWriteFile(targetPath, buffer) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, targetPath);
}

export function stashConflictFile(homeDir, relPath, device = 'remote', stamp = Date.now()) {
  const sourcePath = path.join(homeDir, relPath);
  if (!fs.existsSync(sourcePath)) {
    return null;
  }

  const safeName = relPath.replace(/[/\\]/g, '_');
  const conflictDir = path.join(homeDir, 'sync-state', 'conflicts');
  fs.mkdirSync(conflictDir, { recursive: true });

  const destPath = path.join(conflictDir, `${safeName}.${device}.${stamp}.bak`);
  fs.copyFileSync(sourcePath, destPath);
  return destPath;
}

export function hashBuffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
