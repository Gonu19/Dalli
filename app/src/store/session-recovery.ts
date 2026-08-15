/**
 * 비정상 종료 복구 (`ROADMAP.md` `F1-10`, PRD §18).
 *
 * 러닝 중에는 주기적으로 스냅샷을 남긴다. 앱이 죽거나 iOS가 프로세스를 회수해도
 * **거기까지 달린 기록은 살아남는다.** 다시 켰을 때 큐로 옮겨 업로드한다.
 *
 * 러닝을 이어서 재개하지는 않는다 — 끊긴 구간의 시간·걸음을 알 수 없으므로
 * 이어붙이면 지표가 거짓이 된다. 끊긴 지점까지를 하나의 러닝으로 저장한다.
 */

import { Directory, File, Paths } from 'expo-file-system';

import { buildRecord } from './runStore';
import type { RunRecord, RunSnapshot } from './runStore';
import { enqueueRun } from './upload-queue';

const ACTIVE_FILE = 'active-run.json';

/** 스냅샷 저장 주기(초). 촘촘히 쓰면 배터리를, 성기게 쓰면 기록을 잃는다. */
export const SNAPSHOT_INTERVAL_SEC = 30;

function activeFile(): File {
  const directory = new Directory(Paths.document, 'runs');
  if (!directory.exists) directory.create({ intermediates: true });
  return new File(directory, ACTIVE_FILE);
}

export function saveSnapshot(snapshot: RunSnapshot): void {
  try {
    activeFile().write(JSON.stringify(snapshot));
  } catch {
    // 스냅샷 실패가 러닝을 멈추지 않는다.
  }
}

/** 정상 종료 시 호출 — 복구할 것이 없다는 표시다. */
export function clearSnapshot(): void {
  try {
    const file = activeFile();
    if (file.exists) file.delete();
  } catch {
    // 무시.
  }
}

/**
 * 앱 시작 시 호출. 끊긴 러닝이 있으면 업로드 큐로 옮기고 그 기록을 돌려준다.
 * `completed: false`로 저장한다 — 사용자가 완주를 선언한 적이 없다.
 */
export function recoverInterruptedRun(): RunRecord | null {
  let snapshot: RunSnapshot;

  try {
    const file = activeFile();
    if (!file.exists) return null;
    snapshot = JSON.parse(file.textSync()) as RunSnapshot;
  } catch {
    clearSnapshot();
    return null;
  }

  // 너무 짧은 조각은 복구해도 분석 불가라 사용자에게 혼란만 준다 (서버 기준 3분).
  if (snapshot?.clientRunId === undefined || snapshot.totalSec < 180) {
    clearSnapshot();
    return null;
  }

  const record = buildRecord(snapshot, false);
  enqueueRun(record);
  clearSnapshot();
  return record;
}
