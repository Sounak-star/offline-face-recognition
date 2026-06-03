/**
 * TemplateStore — encrypted, on-device face-template database.
 *
 * Storage stack:
 *   react-native-mmkv v4  (createMMKV API, AES-128 encrypted at rest)
 *     16-byte encryption key → expo-secure-store / Android Keystore
 *
 * Data model:
 *   Person { id, name, embeddings: number[][], createdAt }
 *   Key: STORAGE_KEY_EMBEDDINGS → JSON-encoded Person[]
 *
 * All public methods are async because the MMKV instance is created after
 * the encryption key is retrieved from the secure enclave.
 *
 * SECURITY NOTE: only embedding vectors (float arrays) are ever stored.
 * Raw images and video frames are NEVER written to disk or this store.
 */
import { createMMKV } from 'react-native-mmkv';
import type { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEY_EMBEDDINGS, SECURE_KEY_MMKV } from '@/lib/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Person {
  id:         string;
  name:       string;
  /** Each inner array is one L2-normalised embedding of length EMBEDDING_SIZE. */
  embeddings: number[][];
  createdAt:  number;
}

// ─── Internal singleton ───────────────────────────────────────────────────────

let _db:          MMKV | null = null;
let _initPromise: Promise<MMKV> | null = null;

/** Compact ID: base-36 timestamp + random suffix. */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Retrieve or create the AES-128 encryption key (max 16 chars).
 * Stored in the Android Keystore via expo-secure-store.
 */
async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(SECURE_KEY_MMKV);
  if (existing) return existing;

  // Generate 8 random bytes → 16 hex chars (AES-128 key length limit).
  const buf = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  const key = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(SECURE_KEY_MMKV, key);
  return key;
}

async function getDb(): Promise<MMKV> {
  if (_db)          return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const encKey = await getOrCreateKey();
    const db = createMMKV({ id: 'face-recognition-db', encryptionKey: encKey });
    _db = db;
    console.log('[TemplateStore] Encrypted MMKV ready.');
    return db;
  })();

  return _initPromise;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readPeople(): Promise<Person[]> {
  const db  = await getDb();
  const raw = db.getString(STORAGE_KEY_EMBEDDINGS);
  if (!raw) return [];
  try { return JSON.parse(raw) as Person[]; }
  catch { return []; }
}

async function writePeople(people: Person[]): Promise<void> {
  const db = await getDb();
  db.set(STORAGE_KEY_EMBEDDINGS, JSON.stringify(people));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const TemplateStore = {
  /** Create a new person record with no embeddings yet. Returns the new Person. */
  async createPerson(name: string): Promise<Person> {
    const people  = await readPeople();
    const person: Person = {
      id:         generateId(),
      name:       name.trim(),
      embeddings: [],
      createdAt:  Date.now(),
    };
    people.push(person);
    await writePeople(people);
    return person;
  },

  /**
   * Append one embedding vector to an existing person.
   * @param personId  Target person's ID.
   * @param vec       L2-normalised Float32Array of length EMBEDDING_SIZE.
   */
  async addEmbedding(personId: string, vec: Float32Array): Promise<void> {
    const people = await readPeople();
    const person = people.find((p) => p.id === personId);
    if (!person) throw new Error(`TemplateStore: person not found — ${personId}`);
    person.embeddings.push(Array.from(vec));
    await writePeople(people);
  },

  /** All enrolled people (shallow copy). */
  async listPeople(): Promise<Person[]> {
    return readPeople();
  },

  /** Single person by ID, or null. */
  async getPerson(id: string): Promise<Person | null> {
    const people = await readPeople();
    return people.find((p) => p.id === id) ?? null;
  },

  /** Permanently remove a person and all their embeddings. */
  async deletePerson(id: string): Promise<void> {
    const people = await readPeople();
    await writePeople(people.filter((p) => p.id !== id));
  },
};
