/**
 * 업로드 재시도 큐 — 파일 저장 어댑터 (`ROADMAP.md` `F1-10`, FR-017·029).
 *
 * 러닝은 **서버보다 먼저 기기에 저장된다.** 비행기 모드에서 끝내든 앱이 죽든
 * 기록이 사라지지 않아야 한다. 20분을 달리고 결과를 잃는 것이 이 앱에서 가장 나쁜 실패다.
 *
 * 규칙 자체는 `queue-core.ts`에 있고 여기서는 파일로 읽고 쓰기만 한다.
 * `client_run_id`가 파일명이라 같은 러닝이 두 항목으로 갈라지지 않는다.
 */

import { Directory, File, Paths } from 'expo-file-system';

import { createQueue } from './queue-core';
import type { QueuedRun, QueueStorage } from './queue-core';

const QUEUE_DIR = 'runs';
const SUFFIX = '.json';
const ACTIVE_FILE = 'active-run.json';

export function queueDirectory(): Directory {
  const directory = new Directory(Paths.document, QUEUE_DIR);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

const fileStorage: QueueStorage = {
  list() {
    const entries: QueuedRun[] = [];

    for (const item of queueDirectory().list()) {
      if (!(item instanceof File)) continue;
      if (!item.name.endsWith(SUFFIX) || item.name === ACTIVE_FILE) continue;

      try {
        const parsed = JSON.parse(item.textSync()) as QueuedRun;
        if (parsed?.record?.clientRunId !== undefined) entries.push(parsed);
      } catch {
        // 깨진 파일 하나가 나머지 동기화를 막지 않는다.
        item.delete();
      }
    }

    return entries;
  },

  write(entry) {
    new File(queueDirectory(), `${entry.record.clientRunId}${SUFFIX}`).write(JSON.stringify(entry));
  },

  remove(clientRunId) {
    const file = new File(queueDirectory(), `${clientRunId}${SUFFIX}`);
    if (file.exists) file.delete();
  },
};

const queue = createQueue(fileStorage);

const listeners = new Set<() => void>();

function emitQueueChanged() {
  for (const listener of listeners) listener();
}

export function subscribeQueue(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function enqueueRun(record: Parameters<typeof queue.enqueue>[0]) {
  const entry = queue.enqueue(record);
  emitQueueChanged();
  return entry;
}

export function dequeueRun(clientRunId: string) {
  queue.dequeue(clientRunId);
  emitQueueChanged();
}

export const listQueuedRuns = queue.list;
export function markAttemptFailed(clientRunId: string, error: unknown) {
  const entry = queue.markFailed(clientRunId, error);
  emitQueueChanged();
  return entry;
}

export const hasPendingRuns = queue.hasPending;
/** 네트워크가 돌아왔을 때·앱을 다시 켰을 때 호출한다. */
export async function flushQueue(upload: Parameters<typeof queue.flush>[0]) {
  const result = await queue.flush(upload);
  emitQueueChanged();
  return result;
}

export type { QueuedRun } from './queue-core';
