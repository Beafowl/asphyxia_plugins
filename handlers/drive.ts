import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { NauticaSong } from '../models/nautica_song';

// archiver must be required (not imported) because the plugin tsconfig has no esModuleInterop
const archiver = require('archiver');

let cachedClient: drive_v3.Drive | null = null;
let cachedKey = '';

function buildClient(): drive_v3.Drive | null {
  if (!U.GetConfig('sdvx_drive_enabled')) return null;

  const clientId = (U.GetConfig('sdvx_drive_oauth_client_id') || '').trim();
  const clientSecret = (U.GetConfig('sdvx_drive_oauth_client_secret') || '').trim();
  const refreshToken = (U.GetConfig('sdvx_drive_oauth_refresh_token') || '').trim();
  if (!clientId || !clientSecret || !refreshToken) return null;

  const key = `${clientId}|${refreshToken}`;
  if (cachedClient && cachedKey === key) return cachedClient;

  try {
    const oauth = new OAuth2Client(clientId, clientSecret);
    oauth.setCredentials({ refresh_token: refreshToken });
    cachedClient = google.drive({ version: 'v3', auth: oauth });
    cachedKey = key;
    return cachedClient;
  } catch (err: any) {
    console.error(`[Drive] Failed to build OAuth client: ${err.message}`);
    return null;
  }
}

export function isDriveEnabled(): boolean {
  if (!buildClient()) return false;
  const folderId = (U.GetConfig('sdvx_drive_folder_id') || '').trim();
  return !!folderId;
}

export function getDirectDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

export async function uploadSongZip(song: NauticaSong): Promise<{ fileId: string; size: number } | null> {
  const drive = buildClient();
  if (!drive) return null;
  const folderId = (U.GetConfig('sdvx_drive_folder_id') || '').trim();
  if (!folderId) return null;

  const gameRoot = U.GetConfig('sdvx_eg_root_dir');
  const mixName = U.GetConfig('sdvx_custom_mix_name') || 'asphyxia_custom';
  if (!gameRoot || !fs.existsSync(gameRoot)) return null;

  const modBase = path.join(gameRoot, 'data_mods', mixName);
  const musicBase = path.join(modBase, 'music');
  if (!fs.existsSync(musicBase)) return null;

  const idStr = String(song.mid).padStart(4, '0');
  const songFolder = fs.readdirSync(musicBase).find(d => d.startsWith(idStr + '_'));
  if (!songFolder) return null;

  const zipBuffer = await buildSongZip(modBase, songFolder, idStr);

  // Replace previous upload for this chart if present
  if (song.driveFileId) {
    try { await drive.files.delete({ fileId: song.driveFileId }); } catch {}
  }

  const fileName = `${idStr}_${song.nauticaId}.zip`;
  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId], mimeType: 'application/zip' },
    media: { mimeType: 'application/zip', body: Readable.from(zipBuffer) },
    fields: 'id',
    supportsAllDrives: true,
  });

  const fileId = created.data.id;
  if (!fileId) return null;

  // Make the file publicly readable so the sync script can fetch it without auth
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true,
    });
  } catch (err: any) {
    console.error(`[Drive] Failed to set public permission on ${fileId}: ${err.message}`);
  }

  return { fileId, size: zipBuffer.length };
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const drive = buildClient();
  if (!drive) return;
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch (err: any) {
    console.error(`[Drive] Delete failed for ${fileId}: ${err.message}`);
  }
}

function buildSongZip(modBase: string, songFolder: string, idStr: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 5 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    const musicDir = path.join(modBase, 'music', songFolder);
    if (fs.existsSync(musicDir)) {
      archive.directory(musicDir, `music/${songFolder}`);
    }

    const thumbDir = path.join(modBase, 'graphics', 's_jacket00_ifs');
    if (fs.existsSync(thumbDir)) {
      for (const t of fs.readdirSync(thumbDir).filter(f => f.startsWith(`jk_${idStr}_`))) {
        archive.file(path.join(thumbDir, t), { name: `graphics/s_jacket00_ifs/${t}` });
      }
    }

    archive.finalize();
  });
}
