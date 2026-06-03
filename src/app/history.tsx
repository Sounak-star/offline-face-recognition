import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { HistoryStore, AttendanceLog } from '@/services/HistoryStore';
import { SyncService } from '@/services/SyncService';

export default function HistoryScreen() {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [syncing, setSyncing] = useState(false);

  const fetchLogs = useCallback(async () => {
    const data = await HistoryStore.getLogs();
    setLogs(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchLogs();
    }, [fetchLogs])
  );

  const handleManualSync = async () => {
    if (syncing) return;
    setSyncing(true);
    await SyncService.syncPendingLogs();
    await fetchLogs();
    setSyncing(false);
  };

  const pendingCount = logs.filter(l => !l.synced).length;

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="title">History</ThemedText>
          <TouchableOpacity 
            style={[styles.syncBtn, (syncing || pendingCount === 0) && styles.syncBtnDisabled]}
            onPress={handleManualSync}
            disabled={syncing || pendingCount === 0}
          >
            {syncing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.syncBtnText}>Sync Now ({pendingCount})</Text>}
          </TouchableOpacity>
        </View>

        {logs.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No attendance logs found.</Text>
            <Text style={styles.emptySubtext}>Logs will appear here after verification.</Text>
          </View>
        ) : (
          <FlatList
            data={logs}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.logCard}>
                <View style={styles.logHeader}>
                  <Text style={styles.logName}>{item.personName}</Text>
                  <Text style={styles.logTime}>{new Date(item.timestamp).toLocaleString()}</Text>
                </View>
                <View style={styles.logDetails}>
                  <Text style={styles.logScore}>Match: {(item.matchScore * 100).toFixed(1)}%</Text>
                  <Text style={[styles.logLiveness, { color: item.livenessPassed ? '#30D158' : '#FF453A' }]}>
                    Liveness: {item.livenessPassed ? 'PASS' : 'FAIL'}
                  </Text>
                </View>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    paddingBottom: 16,
  },
  syncBtn: {
    backgroundColor: '#0A84FF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  syncBtnDisabled: {
    backgroundColor: 'rgba(10,132,255,0.4)',
  },
  syncBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  list: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 12,
  },
  logCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  logName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  logTime: {
    color: '#888',
    fontSize: 12,
  },
  logDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  logScore: {
    color: '#aaa',
    fontSize: 14,
  },
  logLiveness: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
  },
});
