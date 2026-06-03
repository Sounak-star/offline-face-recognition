import NetInfo from '@react-native-community/netinfo';
import { HistoryStore } from './HistoryStore';

// Mock AWS endpoint for the hackathon prototype
const AWS_MOCK_ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

export const SyncService = {
  start() {
    console.log('[SyncService] Starting background sync listener...');
    
    // Listen to network changes
    NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable) {
        console.log('[SyncService] Network restored. Attempting sync...');
        this.syncPendingLogs();
      }
    });
    
    // Attempt sync on app start if already online
    NetInfo.fetch().then(state => {
      if (state.isConnected && state.isInternetReachable) {
        this.syncPendingLogs();
      }
    });
  },

  async syncPendingLogs() {
    try {
      const logs = await HistoryStore.getLogs();
      const pending = logs.filter(log => !log.synced);
      
      if (pending.length === 0) {
        console.log('[SyncService] No pending logs to sync.');
        return;
      }
      
      console.log(`[SyncService] Found ${pending.length} logs. Syncing to AWS...`);
      
      // Send bulk upload to mock AWS server
      const response = await fetch(AWS_MOCK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: pending }),
      });
      
      if (response.ok || response.status === 201) {
        console.log('[SyncService] Sync successful! Purging local data...');
        const pendingIds = pending.map(l => l.id);
        await HistoryStore.markAsSynced(pendingIds);
        await HistoryStore.purgeSynced();
        console.log('[SyncService] Local purge complete.');
      } else {
        console.warn(`[SyncService] Sync failed with status: ${response.status}`);
      }
    } catch (error) {
      console.error('[SyncService] Sync error:', error);
    }
  }
};
