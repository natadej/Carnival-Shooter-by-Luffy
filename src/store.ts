import { LIMBS, type CharacterData, type LimbKey } from './character';
import { blobToCanvas, toBlob, type Pt } from './util';

const DB = 'carnival-shooter';
const STORE = 'friends';

interface StoredPart {
  blob: Blob;
  ax: number;
  ay: number;
  len: number;
}

interface Stored {
  id: string;
  name: string;
  createdAt: number;
  head: { blob: Blob; chin: Pt; mouth: Pt; mouthW: number; faceW: number };
  colors: CharacterData['colors'];
  torso?: StoredPart & { neck: Pt; shL: Pt; shR: Pt; hipL: Pt; hipR: Pt };
  limbs: Partial<Record<LimbKey, StoredPart>>;
  headToBody?: number;
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((res, rej) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      }),
  );
}

export async function saveFriend(c: CharacterData): Promise<void> {
  const limbs: Stored['limbs'] = {};
  for (const k of LIMBS) {
    const p = c.limbs[k];
    if (p) limbs[k] = { blob: await toBlob(p.img), ax: p.ax, ay: p.ay, len: p.len };
  }
  const { head, torso } = c;
  const s: Stored = {
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    head: { blob: await toBlob(head.img), chin: head.chin, mouth: head.mouth, mouthW: head.mouthW, faceW: head.faceW },
    colors: c.colors,
    torso: torso && { ...torso, img: undefined, blob: await toBlob(torso.img) } as Stored['torso'],
    limbs,
    headToBody: c.headToBody,
  };
  if (s.torso) delete (s.torso as { img?: unknown }).img;
  await tx('readwrite', (st) => st.put(s));
}

export async function loadFriends(): Promise<CharacterData[]> {
  const all = (await tx('readonly', (st) => st.getAll())) as Stored[];
  const out: CharacterData[] = [];
  for (const s of all) {
    try {
      const limbs: CharacterData['limbs'] = {};
      for (const k of LIMBS) {
        const p = s.limbs[k];
        if (p) limbs[k] = { img: await blobToCanvas(p.blob), ax: p.ax, ay: p.ay, len: p.len };
      }
      const { blob: hb, ...head } = s.head;
      let torso: CharacterData['torso'];
      if (s.torso) {
        const { blob: tb, ...t } = s.torso;
        torso = { ...t, img: await blobToCanvas(tb) };
      }
      out.push({
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        head: { ...head, img: await blobToCanvas(hb) },
        colors: s.colors,
        torso,
        limbs,
        headToBody: s.headToBody,
      });
    } catch (e) {
      console.warn('could not load friend', s.id, e);
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export async function renameFriend(id: string, name: string): Promise<void> {
  const s = (await tx('readonly', (st) => st.get(id))) as Stored | undefined;
  if (!s) return;
  s.name = name;
  await tx('readwrite', (st) => st.put(s));
}

export function deleteFriend(id: string): Promise<undefined> {
  return tx('readwrite', (st) => st.delete(id));
}
