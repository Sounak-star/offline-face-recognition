import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { HistoryStore, AttendanceLog } from '@/services/HistoryStore';
import { SyncService } from '@/services/SyncService';

export default function HistoryScreen() {
  const [logs, setLogs]         = useState<AttendanceLog[]>([]);
  const [syncing, setSyncing]   = useState(false);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [toast, setToast]       = useState<string | null>(null);
  const toastTimer              = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Online / offline indicator ────────────────────────────────────────────
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOnline(!!(state.isConnected && state.isInternetReachable));
    });
    NetInfo.fetch().then(state => {
      setIsOnline(!!(state.isConnected && state.isInternetReachable));
    });
    return () => unsub();
  }, []);

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  // ── Data ──────────────────────────────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    const data = await HistoryStore.getLogs();
    setLogs(data);
  }, []);

  useFocusEffect(useCallback(() => { fetchLogs(); }, [fetchLogs]));

  // ── Manual sync ───────────────────────────────────────────────────────────
  const handleManualSync = async () => {
    if (syncing) return;
    setSyncing(true);
    const synced = await SyncService.syncPendingLogs();
    await fetchLogs();
    setSyncing(false);
    if (synced > 0) {
      showToast(`Synced & purged ${synced} record${synced !== 1 ? 's' : ''}`);
    } else {
      showToast('Nothing to sync right now');
    }
  };

  const pendingCount = logs.filter(l => !l.synced).length;
  const syncDisabled = !isOnline || syncing || pendingCount === 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>

        {/* Header row */}
        <View style={styles.header}>
          <ThemedText type="title">History</ThemedText>
          <View style={styles.headerRight}>
            {isOnline !== null && (
              <View style={[styles.onlineDot, isOnline ? styles.dotOnline : styles.dotOffline]}>
                <Text style={styles.onlineDotText}>{isOnline ? 'Online' : 'Offline'}</Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.syncBtn, syncDisabled && styles.syncBtnDisabled]}
              onPress={handleManualSync}
              disabled={syncDisabled}
            >
              {syncing
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.syncBtnText}>Sync ({pendingCount})</Text>
              }
            </TouchableOpacity>
          </View>
        </View>

        {/* Toast */}
        {toast !== null && (
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}

        {/* List */}
        {logs.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No attendance logs yet.</Text>
            <Text style={styles.emptySubtext}>Records appear here after a successful verification.</Text>
          </View>
        ) : (
          <FlatList
            data={logs}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => <LogCard item={item} />}
          />
        )}

      </SafeAreaView>
    </View>
  );
}

// ─── Log card ─────────────────────────────────────────────────────────────────

function LogCard({ item }: { item: AttendanceLog }) {
  return (
    <View style={[styles.logCard, item.synced && styles.logCardSynced]}>
      {/* Name + synced badge */}
      <View style={styles.logHeader}>
        <Text style={styles.logName}>{item.personName}</Text>
        <View style={[styles.syncedBadge, item.synced ? styles.badgeSynced : styles.badgePending]}>
          <Text style={[styles.syncedBadgeText, item.synced ? styles.badgeSyncedText : styles.badgePendingText]}>
            {item.synced ? 'Synced' : 'Pending'}
          </Text>
        </View>
      </View>

      {/* Timestamp */}
      <Text style={styles.logTime}>{new Date(item.timestamp).toLocaleString()}</Text>

      {/* Score + liveness */}
      <View style={styles.logDetails}>
        <Text style={styles.logScore}>Match: {(item.matchScore * 100).toFixed(1)}%</Text>
        <Text style={[styles.logLiveness, { color: item.livenessPassed ? '#30D158' : '#FF453A' }]}>
          Liveness: {item.livenessPassed ? '✓ PASS' : '✗ FAIL'}
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  safeArea:  { flex: 1 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  onlineDot: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  dotOnline:  { backgroundColor: 'rgba(48,209,88,0.18)' },
  dotOffline: { backgroundColor: 'rgba(255,69,58,0.18)' },
  onlineDotText: { fontSize: 12, fontWeight: '600' },

  syncBtn: {
    backgroundColor: '#0A84FF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 88,
    alignItems: 'center',
  },
  syncBtnDisabled: { backgroundColor: 'rgba(10,132,255,0.35)' },
  syncBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  toast: {
    marginHorizontal: 24,
    marginBottom: 12,
    backgroundColor: 'rgba(48,209,88,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(48,209,88,0.4)',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  toastText: { color: '#30D158', fontSize: 14, fontWeight: '600', textAlign: 'center' },

  list: { paddingHorizontal: 24, paddingBottom: 24, gap: 12 },

  logCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  logCardSynced: {
    borderColor: 'rgba(48,209,88,0.20)',
    backgroundColor: 'rgba(48,209,88,0.04)',
  },

  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  logName: { color: '#fff', fontSize: 16, fontWeight: '700', flexShrink: 1, marginRight: 8 },

  syncedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeSynced:       { backgroundColor: 'rgba(48,209,88,0.15)' },
  badgePending:      { backgroundColor: 'rgba(255,159,10,0.15)' },
  syncedBadgeText:   { fontSize: 11, fontWeight: '700' },
  badgeSyncedText:   { color: '#30D158' },
  badgePendingText:  { color: '#FF9F0A' },

  logTime:    { color: '#666', fontSize: 12, marginBottom: 10 },
  logDetails: { flexDirection: 'row', justifyContent: 'space-between' },
  logScore:   { color: '#aaa', fontSize: 14 },
  logLiveness:{ fontSize: 14, fontWeight: '600' },

  emptyState:   { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyText:    { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptySubtext: { color: '#888', fontSize: 14, textAlign: 'center' },
});
