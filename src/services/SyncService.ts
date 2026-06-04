import NetInfo from '@react-native-community/netinfo';
import { HistoryStore, AttendanceLog } from './HistoryStore';

// ─── Pluggable adapter interface ──────────────────────────────────────────────

export interface ISyncAdapter {
  /**
   * Upload unsynced logs to the backend.
   * Returns the IDs of records the server has ACKed (safe to purge).
   */
  syncPending(logs: AttendanceLog[]): Promise<string[]>;
}

// ─── Mock adapter (default — no real backend required for demo) ───────────────

const MOCK_UPLOAD_DELAY_MS = 1200;

export const MockSyncAdapter: ISyncAdapter = {
  async syncPending(logs: AttendanceLog[]): Promise<string[]> {
    console.log(`[MockSync] Simulating upload of ${logs.length} record(s)...`);
    await new Promise<void>(r => setTimeout(r, MOCK_UPLOAD_DELAY_MS));
    const ids = logs.map(l => l.id);
    console.log(`[MockSync] ACK received for ${ids.length} record(s).`);
    return ids;
  },
};

// ─── AWS Amplify DataStore adapter stub ───────────────────────────────────────
// TODO (Phase 7): npm install aws-amplify @aws-amplify/datastore
// TODO: Call Amplify.configure(amplifyconfiguration) once at app start.
// TODO: Generate models with `amplify codegen models` and import AttendanceRecord here.
// TODO: Replace syncPending body with:
//   for (const log of logs) {
//     await DataStore.save(new AttendanceRecord({ ...log }));
//   }
//   return logs.map(l => l.id); // DataStore guarantees eventual consistency
// TODO: Remove the MockSyncAdapter import from ACTIVE_ADAPTER below.

export const AWSAmplifyAdapter: ISyncAdapter = {
  async syncPending(_logs: AttendanceLog[]): Promise<string[]> {
    throw new Error(
      'AWSAmplifyAdapter is not implemented. See TODO comments in SyncService.ts.',
    );
  },
};

// ─── Active adapter selection ────────────────────────────────────────────────
// Switch to AWSAmplifyAdapter here once Phase 7 is complete.

const ACTIVE_ADAPTER: ISyncAdapter = MockSyncAdapter;

// ─── SyncService ─────────────────────────────────────────────────────────────

export const SyncService = {
  start() {
    console.log('[SyncService] Starting background sync listener...');

    NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable) {
        console.log('[SyncService] Network restored. Attempting sync...');
        this.syncPendingLogs();
      }
    });

    NetInfo.fetch().then(state => {
      if (state.isConnected && state.isInternetReachable) {
        this.syncPendingLogs();
      }
    });
  },

  /**
   * Upload all unsynced records via the active adapter, mark them synced,
   * then purge them from local storage.
   * Returns the number of records that were synced and purged.
   */
  async syncPendingLogs(): Promise<number> {
    const netState = await NetInfo.fetch();
    if (!netState.isConnected || !netState.isInternetReachable) {
      console.log('[SyncService] Offline — sync deferred.');
      return 0;
    }

    try {
      const logs = await HistoryStore.getLogs();
      const pending = logs.filter(log => !log.synced);

      if (pending.length === 0) {
        console.log('[SyncService] No pending logs to sync.');
        return 0;
      }

      const adapterName = ACTIVE_ADAPTER === MockSyncAdapter ? 'Mock' : 'AWS';
      console.log(`[SyncService] Syncing ${pending.length} record(s) via ${adapterName} adapter...`);

      const ackedIds = await ACTIVE_ADAPTER.syncPending(pending);

      if (ackedIds.length > 0) {
        await HistoryStore.markAsSynced(ackedIds);
        await HistoryStore.purgeSynced();
        console.log(`[SyncService] ${ackedIds.length} record(s) synced and purged.`);
      }

      return ackedIds.length;
    } catch (error) {
      console.error(
        '[SyncService] Sync failed:',
        error instanceof Error ? error.message : error,
      );
      return 0;
    }
  },
};
