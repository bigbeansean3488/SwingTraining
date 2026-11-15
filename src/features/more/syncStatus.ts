import { useEffect, useState } from 'react';
import { getSyncStatus, onSyncStatus, type SyncState, type SyncStatus } from '../../lib/sync';

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState(getSyncStatus());
  useEffect(() => onSyncStatus(setS), []);
  return s;
}

export function syncLabel(s: SyncState): string {
  switch (s) {
    case 'local':
      return '本機模式';
    case 'signed-out':
      return '未登入';
    case 'offline':
      return '離線中，恢復連線後自動同步';
    case 'syncing':
      return '同步中…';
    case 'error':
      return '同步發生問題';
    case 'idle':
      return '已同步';
  }
}
