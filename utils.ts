import { Counter } from './models/counter';

export function IDToCode(id: number) {
  const padded = _.padStart(id.toString(), 8);
  return `${padded.slice(0, 4)}-${padded.slice(4)}`;
}

export async function GetCounter(key: string) {
  return (await DB.Upsert<Counter>({ collection: 'counter', key: 'mix' }, { $inc: { value: 1 } }))
    .docs[0].value;
}

export function getVersion(info: EamuseInfo) {
  const dateCode = parseInt(info.model.split(':')[4]);
  if (dateCode <= 2013052900) return 1;
  if (dateCode <= 2014112000) return 2;
  if (dateCode <= 2016121200) return 3;
  if (info.method.startsWith('sv4')) return 4;
  if (info.method.startsWith('sv5')) return 5;
  if (dateCode >= 2025122400) return 7;
  if (dateCode >= 2021083100) return -6;
  if (info.method.startsWith('sv6')) return 6;
  return 0;
}

export function getRandomIntInclusive(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1) + min); //The maximum is inclusive and the minimum is inclusive
}

let musicDbCache: any = null;
let validMidSet: Set<string> | null = null;
let musicDbLoadFailed = false;

export async function loadMusicDb() {
  if (musicDbCache) return musicDbCache;
  if (musicDbLoadFailed) return null;
  try {
    const buf = await IO.ReadFile('webui/asset/json/music_db.json');
    if (!buf) {
      musicDbLoadFailed = true;
      return null;
    }
    const mdb = JSON.parse(U.DecodeString(buf, 'utf8'));

    // Merge custom songs if file exists
    if (IO.Exists('webui/asset/json/custom_music_db.json')) {
      try {
        const customBuf = await IO.ReadFile('webui/asset/json/custom_music_db.json');
        if (customBuf) {
          const customDb = JSON.parse(U.DecodeString(customBuf, 'utf8'));
          if (customDb?.mdb?.music?.length) {
            mdb.mdb.music = mdb.mdb.music.concat(customDb.mdb.music);
          }
        }
      } catch {}
    }

    // Build valid MID lookup set
    validMidSet = new Set(mdb.mdb.music.map((s: any) => String(s.id)));

    musicDbCache = mdb;
    return musicDbCache;
  } catch {}
  musicDbLoadFailed = true;
  return null;
}

export function isValidMid(mid: number): boolean {
  if (!validMidSet) return true; // If DB failed to load, don't block scores
  return validMidSet.has(String(mid));
}

export function invalidateMusicDbCache() {
  musicDbCache = null;
  validMidSet = null;
  musicDbLoadFailed = false;
}

// Game crashes with music IDs >= 3072 (internal array limit in soundvoltex.dll)
// Official songs go up to ~1854, so custom charts use 2800-3071 (271 slots)
export const NAUTICA_ID_START = 2800;
export const NAUTICA_ID_END = 3071;

export async function GetNextNauticaId(): Promise<number> {
  const songs = await DB.Find<any>({ collection: 'nautica_song', mid: { $gte: NAUTICA_ID_START } });
  const usedIds = new Set((songs || []).map((s: any) => s.mid));

  for (let id = NAUTICA_ID_START; id <= NAUTICA_ID_END; id++) {
    if (!usedIds.has(id)) {
      await DB.Upsert<Counter>(
        { collection: 'counter', key: 'nautica_music_id' },
        { $set: { value: id } }
      );
      return id;
    }
  }

  throw new Error(`No available music ID slots (all ${NAUTICA_ID_START}-${NAUTICA_ID_END} in use)`);
}

export function computeForce(diff, score, medal, grade) {
  // computing force with Nabla values
  const medalCoef = [0, 0.5, 1.0, 1.02, 1.04, 1.06, 1.1];
  const gradeCoef = [0, 0.8, 0.82, 0.85, 0.88, 0.91, 0.94, 0.97, 1.0, 1.02, 1.05];
  return Math.floor(diff * (score / 10000000) * gradeCoef[grade] * medalCoef[medal] * 20);
}
