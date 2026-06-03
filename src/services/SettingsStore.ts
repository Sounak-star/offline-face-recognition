// SettingsStore – simple MMKV wrapper for similarity threshold
import { createMMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import {
  SECURE_KEY_MMKV,
  STORAGE_KEY_LIVENESS_ENABLED,
} from '@/lib/config';

const THRESHOLD_KEY = 'similarity_threshold';

let _db = null as any;
let _initPromise: Promise<any> | null = null;

async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(SECURE_KEY_MMKV);
  if (existing) return existing;
  // reuse same generation logic as TemplateStore
  const buf = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  const key = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(SECURE_KEY_MMKV, key);
  return key;
}

async function getDb() {
  if (_db) return _db;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const encKey = await getOrCreateKey();
    const db = createMMKV({ id: 'face-recognition-db', encryptionKey: encKey });
    _db = db;
    return db;
  })();
  return _initPromise;
}

export const SettingsStore = {
  async getThreshold(defaultValue: number): Promise<number> {
    const db = await getDb();
    const val = db.getNumber(THRESHOLD_KEY);
    return typeof val === 'number' ? val : defaultValue;
  },
  async setThreshold(value: number): Promise<void> {
    const db = await getDb();
    db.set(THRESHOLD_KEY, value);
  },
  async getLivenessEnabled(defaultValue: boolean = true): Promise<boolean> {
    const db = await getDb();
    const val = db.getBoolean(STORAGE_KEY_LIVENESS_ENABLED);
    return typeof val === 'boolean' ? val : defaultValue;
  },
  async setLivenessEnabled(value: boolean): Promise<void> {
    const db = await getDb();
    db.set(STORAGE_KEY_LIVENESS_ENABLED, value);
  },
};
