import NetInfo from '@react-native-community/netinfo';
import { HistoryStore } from './HistoryStore';

// Mock AWS endpoint for the hackathon prototype
const AWS_MOCK_ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000; // 2s → 4s → 8s exponential backoff

/** Sleep helper for backoff delays. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

  /**
   * Attempt a fetch request with exponential backoff retry.
   * Retries up to MAX_RETRIES times with delays of 2s, 4s, 8s.
   * Only retries on network errors or 5xx server errors; 4xx errors
   * are considered non-retryable and will throw immediately.
   */
  async fetchWithRetry(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, options);

        // Don't retry client errors (4xx) — they won't resolve on their own
        if (response.status >= 400 && response.status < 500) {
          return response;
        }

        // Retry on server errors (5xx)
        if (response.status >= 500) {
          lastError = new Error(`Server error: ${response.status}`);
          console.warn(
            `[SyncService] Attempt ${attempt}/${MAX_RETRIES} failed (HTTP ${response.status}).`,
          );
        } else {
          // Success (2xx / 3xx)
          return response;
        }
      } catch (error) {
        // Network or fetch-level error (e.g. DNS failure, timeout)
        lastError = error;
        console.warn(
          `[SyncService] Attempt ${attempt}/${MAX_RETRIES} failed (network error):`,
          error instanceof Error ? error.message : error,
        );
      }

      // Wait before retrying (exponential backoff: 2s, 4s, 8s)
      if (attempt < MAX_RETRIES) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[SyncService] Retrying in ${delayMs / 1000}s...`);
        await sleep(delayMs);
      }
    }

    // All retries exhausted
    throw lastError;
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
      
      // Send bulk upload to mock AWS server (with retry)
      const response = await this.fetchWithRetry(AWS_MOCK_ENDPOINT, {
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
      console.error(
        '[SyncService] Sync failed after all retries:',
        error instanceof Error ? error.message : error,
      );
    }
  }
};
