import { createMMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import { SECURE_KEY_MMKV, STORAGE_KEY_HISTORY } from '@/lib/config';

export interface AttendanceLog {
  id: string;
  personId: string;
  personName: string;
  timestamp: number;
  matchScore: number;
  livenessPassed: boolean;
  synced: boolean;
}

let _db = null as any;
let _initPromise: Promise<any> | null = null;

async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(SECURE_KEY_MMKV);
  if (existing) return existing;
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

export const HistoryStore = {
  async addLog(log: Omit<AttendanceLog, 'id' | 'synced'>): Promise<AttendanceLog> {
    const db = await getDb();
    const existingStr = db.getString(STORAGE_KEY_HISTORY);
    const logs: AttendanceLog[] = existingStr ? JSON.parse(existingStr) : [];
    
    const newLog: AttendanceLog = {
      ...log,
      id: Math.random().toString(36).substring(2, 9),
      synced: false,
    };
    
    logs.unshift(newLog); // prepend
    db.set(STORAGE_KEY_HISTORY, JSON.stringify(logs));
    return newLog;
  },

  async getLogs(): Promise<AttendanceLog[]> {
    const db = await getDb();
    const str = db.getString(STORAGE_KEY_HISTORY);
    return str ? JSON.parse(str) : [];
  },

  async markAsSynced(ids: string[]): Promise<void> {
    const db = await getDb();
    const str = db.getString(STORAGE_KEY_HISTORY);
    if (!str) return;
    
    const logs: AttendanceLog[] = JSON.parse(str);
    const updated = logs.map(log => 
      ids.includes(log.id) ? { ...log, synced: true } : log
    );
    db.set(STORAGE_KEY_HISTORY, JSON.stringify(updated));
  },

  async purgeSynced(): Promise<void> {
    const db = await getDb();
    const str = db.getString(STORAGE_KEY_HISTORY);
    if (!str) return;
    
    const logs: AttendanceLog[] = JSON.parse(str);
    const pending = logs.filter(log => !log.synced);
    db.set(STORAGE_KEY_HISTORY, JSON.stringify(pending));
  },

  async clearAll(): Promise<void> {
    const db = await getDb();
    db.delete(STORAGE_KEY_HISTORY);
  }
};
