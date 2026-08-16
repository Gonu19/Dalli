/**
 * `F1-10` 검증 — 업로드 큐의 순서·재시도·중복 규칙.
 *
 * 실행 (app/ 에서):
 *   npx tsx src/engine/__dev__/queue-check.ts
 *
 * 저장 어댑터를 메모리로 바꿔 끼워 실기기·서버 없이 확인한다.
 * 파일 어댑터는 같은 규칙을 쓰므로 여기서 통과하면 규칙 자체는 검증된 것이다.
 */

import { createQueue } from '../../store/queue-core';
import type { QueuedRun, QueueStorage } from '../../store/queue-core';
import type { RunRecord } from '../../store/runStore';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  const detail = ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail}`);
}

function memoryStorage(): QueueStorage & { entries: Map<string, QueuedRun> } {
  const entries = new Map<string, QueuedRun>();
  return {
    entries,
    list: () => [...entries.values()],
    write: (entry) => void entries.set(entry.record.clientRunId, entry),
    remove: (id) => void entries.delete(id),
  };
}

function record(clientRunId: string): RunRecord {
  return {
    clientRunId,
    source: 'APP',
    planId: null,
    startedAt: '2026-08-15T09:00:00Z',
    endedAt: '2026-08-15T09:20:00Z',
    goalType: 'TIME',
    goalValue: 1200,
    condition: 3,
    targetCadenceMin: 153,
    targetCadenceMax: 161,
    finalTargetMin: 153,
    finalTargetMax: 161,
    durationSec: 1200,
    distanceM: null,
    avgCadence: 157,
    avgPaceSecPerKm: null,
    completed: true,
    interventionCount: 0,
    downshiftCount: 0,
    samples: [],
    events: [],
    measuredBaseline: 157,
  };
}

async function main() {
// 1. 저장 순서 — 오래된 것부터 올린다
{
  const storage = memoryStorage();
  let clock = 0;
  const queue = createQueue(storage, () => `2026-08-15T09:0${clock++}:00Z`);

  queue.enqueue(record('run-a'));
  queue.enqueue(record('run-b'));
  check('대기 순서', queue.list().map((entry) => entry.record.clientRunId), ['run-a', 'run-b']);
  check('대기 여부', queue.hasPending(), true);
}

// 2. 같은 러닝을 두 번 넣어도 항목은 하나 — 중복 업로드의 씨앗을 만들지 않는다
{
  const storage = memoryStorage();
  const queue = createQueue(storage);
  queue.enqueue(record('run-a'));
  queue.enqueue(record('run-a'));
  check('중복 저장 없음', queue.list().length, 1);
}

// 3. 업로드 성공 → 큐에서 사라진다
{
  const storage = memoryStorage();
  const queue = createQueue(storage);
  queue.enqueue(record('run-a'));

  const sent: string[] = [];
  const result = await queue.flush(async (item) => void sent.push(item.clientRunId));
  check('성공 시 전송', sent, ['run-a']);
  check('성공 시 큐 비움', [result.uploaded, queue.hasPending()], [1, false]);
}

// 4. 실패 → 큐에 남고 시도 횟수가 오른다 (비행기 모드 시나리오)
{
  const storage = memoryStorage();
  const queue = createQueue(storage);
  queue.enqueue(record('run-a'));

  const offline = await queue.flush(async () => {
    throw new Error('Network request failed');
  });
  check('실패해도 기록은 남는다', queue.list().length, 1);
  check('실패 집계', [offline.uploaded, offline.failed], [0, 1]);
  check('시도 횟수·사유 기록', [queue.list()[0].attempts, queue.list()[0].lastError], [
    1,
    'Network request failed',
  ]);

  // 연결이 돌아오면 같은 기록이 그대로 올라간다
  const sent: string[] = [];
  const online = await queue.flush(async (item) => void sent.push(item.clientRunId));
  check('복구 후 동기화', [sent, online.uploaded, queue.hasPending()], [['run-a'], 1, false]);
}

// 5. 첫 실패에서 멈춘다 — 순서를 지키기 위해서다
{
  const storage = memoryStorage();
  let clock = 0;
  const queue = createQueue(storage, () => `2026-08-15T09:0${clock++}:00Z`);
  queue.enqueue(record('run-a'));
  queue.enqueue(record('run-b'));

  const sent: string[] = [];
  const result = await queue.flush(async (item) => {
    sent.push(item.clientRunId);
    throw new Error('offline');
  });
  check('두 번째는 시도하지 않는다', sent, ['run-a']);
  check('둘 다 큐에 남는다', [queue.list().length, result.failed], [2, 1]);
}

// 6. 서버가 멱등이므로 재전송은 안전하다 — 200이 와도 성공으로 처리해 큐를 비운다
{
  const storage = memoryStorage();
  const queue = createQueue(storage);
  queue.enqueue(record('run-a'));

  let calls = 0;
  await queue.flush(async () => {
    calls += 1;
    return { id: 'server-uuid', client_run_id: 'run-a' }; // 기존 레코드 200 응답
  });
  check('멱등 재전송 후 큐 비움', [calls, queue.hasPending()], [1, false]);
}


// 7. 읽기 캐시 — hasPending은 렌더마다 불려도 저장소를 다시 읽지 않는다
{
  const storage = memoryStorage();
  let reads = 0;
  const counting: QueueStorage = {
    list: () => { reads += 1; return storage.list(); },
    write: storage.write,
    remove: storage.remove,
  };
  const queue = createQueue(counting);

  queue.enqueue(record('run-a'));
  const before = reads;
  for (let i = 0; i < 50; i += 1) queue.hasPending();
  check('반복 조회는 저장소를 한 번만 읽는다', reads - before, 1);

  // 쓰기는 캐시를 무효화한다 — 값이 낡지 않는다
  queue.dequeue('run-a');
  check('삭제 후 즉시 반영', queue.hasPending(), false);
  queue.enqueue(record('run-b'));
  check('추가 후 즉시 반영', queue.list().map((entry) => entry.record.clientRunId), ['run-b']);
}

// 8. 반환값 — 호출부가 항목을 바로 쓸 수 있어야 한다
{
  const storage = memoryStorage();
  const queue = createQueue(storage, () => '2026-08-16T09:00:00Z');
  const entry = queue.enqueue(record('run-a'));
  check('enqueue가 항목을 돌려준다', [entry.record.clientRunId, entry.attempts, entry.savedAt], [
    'run-a',
    0,
    '2026-08-16T09:00:00Z',
  ]);

  const failedEntry = queue.markFailed('run-a', new Error('offline'));
  check('markFailed가 갱신된 항목을 돌려준다', [failedEntry?.attempts, failedEntry?.lastError], [1, 'offline']);
  check('없는 항목이면 null', queue.markFailed('run-x', new Error('offline')), null);
}

  console.log(failures === 0 ? '\nOK — 전 항목 통과' : `\nFAILED — ${failures}건`);
  if (failures > 0) process.exitCode = 1;
}

void main();
