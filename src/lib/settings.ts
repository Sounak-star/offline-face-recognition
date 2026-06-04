import { MMKV, useMMKVNumber } from 'react-native-mmkv';
import { MATCH_COSINE_THRESHOLD } from './config';

export const settingsStorage = new MMKV({ id: 'settings' });

export function useSimilarityThreshold() {
  const [threshold, setThreshold] = useMMKVNumber('similarity_threshold', settingsStorage);
  return [threshold ?? MATCH_COSINE_THRESHOLD, setThreshold] as const;
}

export function getSimilarityThreshold() {
  const threshold = settingsStorage.getNumber('similarity_threshold');
  return threshold ?? MATCH_COSINE_THRESHOLD;
}
