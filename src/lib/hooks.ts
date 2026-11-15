import { useCallback, useEffect, useState } from 'react';
import { getMeta, getRow, listRows, pendingOutbox, subscribe } from './db';
import type { RowByTable, TableName } from './types';

/** All live rows of a table, re-read whenever the table changes. */
export function useRows<T extends TableName>(
  table: T,
  filter?: (r: RowByTable[T]) => boolean,
  deps: unknown[] = [],
): RowByTable[T][] | null {
  const [rows, setRows] = useState<RowByTable[T][] | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const f = useCallback(filter ?? (() => true), deps);
  useEffect(() => {
    let alive = true;
    const load = () =>
      listRows(table).then((r) => {
        if (alive) setRows(r.filter(f));
      });
    load();
    const off = subscribe((t) => {
      if (t === table) load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [table, f]);
  return rows;
}

export function useRow<T extends TableName>(
  table: T,
  id: string | undefined,
): RowByTable[T] | null | undefined {
  const [row, setRow] = useState<RowByTable[T] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (!id) {
      setRow(null);
      return;
    }
    const load = () =>
      getRow(table, id).then((r) => {
        if (alive) setRow(r ?? null);
      });
    load();
    const off = subscribe((t) => {
      if (t === table) load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [table, id]);
  return row;
}

export function useMeta<T>(key: string): T | undefined {
  const [v, setV] = useState<T | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getMeta<T>(key).then((x) => {
        if (alive) setV(x);
      });
    load();
    const off = subscribe((t) => {
      if (t === 'meta') load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [key]);
  return v;
}

export function useOutboxCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      pendingOutbox().then((o) => {
        if (alive) setN(new Set(o.map((x) => `${x.table}/${x.id}`)).size);
      });
    load();
    const off = subscribe((t) => {
      if (t === 'outbox') load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return n;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
