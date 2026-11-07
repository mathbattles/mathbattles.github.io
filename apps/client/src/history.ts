import type { MatchRecord } from '@mathbattles/sim';
import { fetchHistory, uploadHistory } from './net/api';

const KEY = 'mathbattles.history.v1';
const MAX_LOCAL = 50;

function read(): MatchRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as MatchRecord[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: MatchRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_LOCAL)));
  } catch {
    /* Storage is full or unavailable, so this match just isn't kept. */
  }
}

/**
 * Saves a finished match. Guest matches stay on this device. For an account, it goes to the
 * server, and stays here only until that works.
 */
export async function recordMatchHistory(record: MatchRecord, token: string | null): Promise<void> {
  write([record, ...read().filter((r) => r.id !== record.id)]);
  if (token) await uploadPending(token);
}

/** Sends waiting matches to the account. This also brings over matches played as a guest. */
export async function uploadPending(token: string): Promise<void> {
  const left: MatchRecord[] = [];
  for (const r of read()) {
    const ok = await uploadHistory(token, r);
    if (!ok) left.push(r);
  }
  write(left);
}

export async function loadHistory(token: string | null): Promise<MatchRecord[]> {
  const local = read();
  if (!token) return local;
  const server = (await fetchHistory(token)) ?? [];
  const seen = new Set(server.map((r) => r.id));
  return [...local.filter((r) => !seen.has(r.id)), ...server].sort((a, b) => b.at - a.at);
}
