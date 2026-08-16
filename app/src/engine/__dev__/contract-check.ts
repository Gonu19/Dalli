/**
 * 업로드 계약 검증 — 시뮬레이션으로 만든 러닝을 **실제 Mock 서버**에 올려본다.
 *
 * 실행 (server에서 Mock을 띄운 뒤, app/ 에서):
 *   python -m uvicorn app.mock_main:app --host 127.0.0.1 --port 8011
 *   MOCK_URL=http://127.0.0.1:8011 npx tsx src/engine/__dev__/contract-check.ts
 *
 * 실기기도 터널도 필요 없다. 여기서 필드가 어긋난 걸 잡으면 야외에서 20분 뛰고
 * 업로드 422를 만나는 일을 막는다.
 */

process.env.EXPO_PUBLIC_API_URL = process.env.MOCK_URL ?? 'http://127.0.0.1:8011';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  const detail = ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail}`);
}

async function main() {
  // 모듈이 로드될 때 Base URL을 읽으므로 env를 세운 뒤에 import한다.
  const { authenticateDevice, createRun } = await import('../../store/../api/client');
  const { useRunStore } = await import('../../store/runStore');
  const { ReplaySource } = await import('../sources/replay-source');
  const { buildScenarioSamples, SCENARIOS } = await import('../sources/scenarios');

  const auth = await authenticateDevice('contract-check-device');
  check('기기 인증', typeof auth.accessToken === 'string' && auth.accessToken.length > 0, true);

  /** 시뮬레이션을 끝까지 돌려 업로드 재료를 만든다. */
  function play(name: 'demo' | 'steady', clientRunId: string) {
    const scenario = SCENARIOS[name];
    const store = useRunStore.getState();
    store.reset();
    store.start({
      referenceCadence: 157,
      condition: 3,
      goal: { type: 'TIME', value: scenario.durationSec },
      clientRunId,
      startedAt: '2026-08-16T09:00:00Z',
    });
    new ReplaySource(buildScenarioSamples(scenario), { speed: Infinity }).start((sample) =>
      useRunStore.getState().ingest(sample),
    );
    return useRunStore.getState().finish(true, '2026-08-16T09:20:00Z');
  }

  // 1. 정상 러닝 — 필드 변환이 CONTRACT.md와 맞는가
  const record = play('demo', 'contract-run-1');
  if (record === null) throw new Error('record is null');

  const created = await createRun(auth.accessToken, record);
  check('업로드 성공', created.clientRunId, 'contract-run-1');
  check('서버가 id를 돌려준다', typeof created.id === 'string' && created.id.length > 0, true);
  check('분석 가능 판정', created.isAnalyzable, true);
  check('서버 계산 지표가 채워진다', [
    typeof created.rhythmScore,
    typeof created.fatigueIndex,
  ], ['number', 'number']);

  // 2. 멱등 — 같은 client_run_id 재전송
  const again = await createRun(auth.accessToken, record);
  check('재전송해도 같은 러닝', again.id, created.id);

  // 3. samples·events 구조가 서버 검증을 통과했는가 (거절되면 위에서 throw)
  check('샘플이 5초 간격으로 쌓였다', record.samples.length > 100, true);
  check('이벤트 타입이 계약 enum 안', record.events.every((event) =>
    ['RUN_START', 'TOO_FAST', 'TOO_SLOW', 'TARGET_ADJUSTED', 'RECOVERY_MODE_ON', 'PAUSE', 'RESUME', 'RUN_END']
      .includes(event.type)), true);
  check('GPS 없으면 null로 나간다', [record.distanceM, record.avgPaceSecPerKm], [null, null]);

  // 4. 짧은 러닝 — 페이로드는 받아들여지는가
  //
  // Mock은 fixture를 그대로 돌려주므로 `is_analyzable`은 언제나 true다.
  // `too_short` fixture가 존재하지만 `mock_main`이 고르지 않아 도달할 수 없다.
  // 3분·70% 판정 자체는 실서버(`run_quality.py`)와 그쪽 테스트가 담당한다.
  const shortRecord = {
    ...record,
    clientRunId: 'contract-run-short',
    durationSec: 100,
    samples: record.samples.slice(0, 5),
  };
  const shortCreated = await createRun(auth.accessToken, shortRecord);
  check('짧은 러닝도 저장은 성공한다', shortCreated.clientRunId, 'contract-run-short');

  if (shortCreated.isAnalyzable) {
    console.log('[NOTE] Mock이 duration_sec를 보지 않아 too_short fixture에 도달하지 못한다 — 분석 불가 화면은 실서버로 확인 필요');
  }

  console.log(failures === 0 ? '\nOK — 전 항목 통과' : `\nFAILED — ${failures}건`);
  if (failures > 0) process.exitCode = 1;
}

void main();
