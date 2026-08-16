# ENGINE.md — 판정 룰 · 상태머신 · 수치표

**소유: 고은우 (Core FE)** · 구현: `app/src/engine/` (순수 TS, `react-native` import 금지)
이 문서의 숫자가 단일 진실. AI에 엔진 코드 요청 시 §1을 그대로 붙여넣을 것.

## 1. 수치표
| 항목 | 값 | 상수 |
| --- | --- | --- |
| 슬라이딩 윈도우 | 20초 | `WINDOW_SEC` |
| 계산 tick | 5초 | `TICK_SEC` |
| 센서 타이머 | 1초 | `SENSOR_TICK_SEC` |
| samples 저장 | 5초 | `SAMPLE_INTERVAL_SEC` |
| 워밍업 무개입 | **90초** | `WARMUP_SEC` |
| `TOO_SLOW` 판정 시작 | **5분(300초) 이후** | `SLOW_JUDGE_START_SEC` |
| 정지 판정 제외 | **< 50 spm** | `IDLE_CADENCE_THRESHOLD` |
| 걷기 구간 | **50 ~ 120 spm** | `WALK_CADENCE_MIN/MAX` |
| 목표 범위 | 중심 ±4 | `TARGET_HALF_WIDTH` |
| 절대 클램프 | **130 ~ 185** (중심값 기준) | `CADENCE_CLAMP_MIN/MAX` |
| 컨디션 보정 | 가벼움 +2 / 보통 0 / 피곤함 −3 | `CONDITION_ADJUST` |
| **초기 목표값 기준** | 경험 `0`/`1`/`2` → **152 / 158 / 164** (§2) | `EXPERIENCE_BASE_CADENCE` |
| **목적 보정** | **−2 ~ +4** (§2) | `PURPOSE_ADJUST` |
| 일반 이탈 | 범위 밖 20초 지속 | `DEVIATION_SEC` |
| 급격 이탈 | ±10 초과 밖 10초 지속 | `SEVERE_DEVIATION_SEC` / `SEVERE_THRESHOLD` |
| 회복 | 중심 ±3 진입 | `RECOVERY_HALF_WIDTH` |
| 쿨다운 | 60초 | `COOLDOWN_SEC` |
| 음성 | ≤3초, 1문장 | — |
| 메트로놈 | 5초 | `METRONOME_SEC` |
| **`TOO_FAST` 세션 상한** | **2회** | `MAX_FAST_INTERVENTION` |
| **`TOO_FAST` 중지 지점** | **목표 90% 도달 이후** | `FAST_MUTE_PROGRESS` |
| Downshift(일반) | 실패 2회 | `DOWNSHIFT_FAIL_NORMAL` |
| Downshift(급격) | 실패 1회 | `DOWNSHIFT_FAIL_SEVERE` |
| Downshift(걷기) | 60초 지속 → 즉시 | `WALK_SEC` |
| 최대 하향 | 2회 | `MAX_DOWNSHIFT` |
| 하향 쿨타임 | 5분 | `DOWNSHIFT_INTERVAL_SEC` |
| 하향 하한 | **130** | `DOWNSHIFT_FLOOR` |
| **1회당 최대 하향폭** | **5 spm** | `MAX_DOWNSHIFT_STEP` |
| 하향 후 안정화 | 새 범위 30초 유지 | `RESTABILIZE_SEC` |
| **컨디션 매핑** | 피곤함 **1** / 보통 **3** / 가벼움 **5** | `CONDITION_VALUE` |
| **리커버리 진입** | **3번째 하향 조건 충족** 또는 **하한 130 도달** | — |

`RECOVERY(±3) < TARGET(±4)` — 경계 깜빡임 방지 히스테리시스. 뒤집지 말 것.

**회복 판정은 언제나 `중심 ±3`이다.** 이탈 진입은 `±4 초과`, 회복 복귀는 `±3 이내`로
기준이 서로 다르다. 쿨다운 종료 시점의 성공/실패 판정도 **`±3` 기준**을 쓴다
(`±4`로 재면 경계값에서 성공/실패가 뒤집힌다).

**비대칭 원칙**: `TOO_FAST`는 개입만 하고 downshift 경로가 없다. `TOO_SLOW`·걷기만 downshift로 간다.
근거는 §7.

## 2. 초기 목표값과 baseline

**둘은 다른 것이다.**

| | 초기 목표값 | baseline |
| --- | --- | --- |
| 언제 | 온보딩 | **1회차 러닝 종료 후** |
| 어떻게 | 규칙표 (경험 수준 × 목적) | 실측 samples의 중앙값 |
| 뜻 | 첫 러닝을 시작할 자리 | **그 사람의 기준 리듬** |
| 수명 | baseline 확정까지만 | 확정 후 계속 사용 |

목표 중심값의 원천이 1회차에는 초기 목표값, 2회차부터는 baseline이다.
엔진은 둘을 구분하지 않고 `referenceCadence` 하나로 받는다 — 어느 쪽인지는 호출하는 쪽이 안다.

- 온보딩 수동 조절: ±5 spm 범위, 1 spm 단위.
- 로직 반영 입력: 경험 수준·목적만. 신체 정보 제외.
- 러닝 중 수동 조절: 불가. **LLM 미사용.**

### 초기 목표값 규칙표

```
initialTarget = clamp(experienceBase + purposeAdjust, 130, 185)
```

| `experience_level` | 뜻 | `experienceBase` |
| --- | --- | --- |
| `0` | 최근 달린 적이 거의 없음 | **152** |
| `1` | 가끔 달림 | **158** |
| `2` | 꾸준히 달림 | **164** |

| `running_purpose` | `purposeAdjust` |
| --- | --- |
| `COMPLETE` (완주) | **0** |
| `HABIT` (습관) | **−2** |
| `WEIGHT` (체중) | **−2** |
| `FITNESS` (체력) | **+2** |
| `PERFORMANCE` (기록) | **+4** |

상수는 `EXPERIENCE_BASE_CADENCE` / `PURPOSE_ADJUST`. 결과는 **150 ~ 168** 범위에 들어오므로
클램프(130/185)는 실제로 걸리지 않는다 — 방어용으로만 둔다.

**의도적으로 낮게 잡는다.** 이 표가 틀렸을 때 두 방향의 대가가 대칭이 아니기 때문이다.

| 틀린 방향 | 세션 중 | 회복 경로 |
| --- | --- | --- |
| 너무 높음 | `TOO_SLOW` 반복 → 실패 → **downshift 2회 소진 → 리커버리** | 없음. 그 러닝이 끝난다 |
| 너무 낮음 | `TOO_FAST` 2회 → **이후 침묵** (§7) | 있음. 리포트가 다음 목표 `+2` (§2 업시프트) |

높게 잡히면 첫 러닝이 하향으로만 흘러가고, 낮게 잡히면 두 번 조용히 알린 뒤 다음 러닝에서
스스로 올라간다. 페르소나의 문제가 *"빠르게 시작 → 10분 후 걸음"*이라는 점도 같은 방향을 가리킨다.

`HABIT`·`WEIGHT`를 낮추는 이유는 둘 다 **오래 편하게 달리는 것이 목적**이라 초반 과속의 대가가
가장 큰 조합이기 때문이다. `PERFORMANCE`만 `+4`로 올리는데, 이 사용자는 자기 리듬을 이미
알고 있어 온보딩 ±5 수동 조절로 스스로 맞출 가능성이 높다.

### 온보딩을 통째로 건너뛴 경우

질문에 하나도 답하지 않고 바로 시작할 수 있다. 이때는 **값을 비워 보내지 않고
기본값을 대신 보낸다** — 비우면 서버의 `onboarded`가 계속 `false`라 앱이 온보딩으로
되돌아온다 (`CONTRACT.md`).

| 필드 | 기본값 |
| --- | --- |
| `running_purpose` | `COMPLETE` |
| `experience_level` | `0` |
| `max_continuous_min` | `10` |
| `weekly_goal_count` | `3` |

상수는 `ONBOARDING_SKIP_DEFAULTS`. 초기 목표값은 이 조합에서 규칙표가 그대로 계산해
**152**가 되고, 사용자는 케이던스 화면에서 ±5로 조절할 수 있다.

가장 보수적인 조합을 고른 이유는 §2의 편향과 같다 — 모르는 사용자에게 높은 목표를
주면 첫 러닝이 하향으로만 흘러간다. 그리고 어차피 **1회차가 끝나면 실측 baseline이
확정되어 이 값은 버려진다.**

> 이 표는 실측이 아니라 설계값이다. **8/16 저녁 야외 테스트 후 실측을 보고 조정한다**
> (§12 FI 경계값과 같은 취급). 조정해도 영향 범위는 1회차 러닝뿐이다 — baseline이 확정되면
> 이 표는 그 사용자에게 두 번 다시 쓰이지 않는다.

### 실측 baseline은 러닝 중이 아니라 **종료 후**에 산출한다

**러닝 중 캘리브레이션 구간은 없다.** 첫 러닝도 다른 러닝과 완전히 동일하게 동작한다.

```
러닝 시작 → 온보딩 추천값으로 목표를 잡고 정상 판정 (첫 러닝도 예외 없음)
러닝 종료 → samples에서 실측 baseline 산출 → 리포트에서 확정 제안
다음 러닝 → 확정된 baseline 사용
```

산출 규칙 — 클라이언트가 종료 시점에 계산해 `PATCH /users/me`로 보낸다.

```
구간   t = 90 ~ 270초 (워밍업 직후 3분)
제외   정지(< 50 spm) 샘플
값     중앙값
조건   유효 샘플 30개 미만이거나 duration < 360초면 확정하지 않는다
```

**러닝 중에 측정할 이유가 없다.** 어차피 `samples`가 5초 간격으로 전부 남고,
확정값을 그 러닝에 적용하면 도중에 목표가 바뀌어 혼란만 생긴다.
(러닝 중 목표 상향은 §7에서 금지한 동작이기도 하다.)

이 결정으로 사라지는 것: `CALIBRATING` 상태, "기준 리듬 측정 중" 화면,
그리고 *"워밍업 90초가 3분에 포함되는가"* 하는 시간축 모호성 전부.

### 세션 간 업시프트
러닝 종료 후 서버가 판정 — `상단(중심~+4) 유지 60% 이상` + `downshift 0회` + `완주`
→ 다음 목표 `+2` 제안. `reports.next_target_min/max`로 전달. **러닝 중 업시프트는 없다.**

### 노출 규칙
| 대상 | 노출 |
| --- | --- |
| baseline 숫자 | **○** — 첫 러닝 리포트("기준 리듬을 찾았어요 — 157"), 리포트 하단, 설정 |
| 러닝 중 화면의 baseline | ✕ |
| 워밍업 구간·타이머 | ✕ (개념 자체를 노출하지 않음) |

평균·권장치와의 비교는 어떤 화면에도 넣지 않는다. 자기 자신과의 비교만 한다.

## 3. Target Range
```
center    = clamp(baseline + conditionAdjust, 130, 185)
targetMin = center - 4
targetMax = center + 4
```
클램프는 center에만 적용 (min/max 각각에 걸면 범위 폭이 찌그러짐).

### 컨디션 — UI 3단계, 저장값 1/3/5
UI는 3단계지만 DB·API·FI는 `1~5` 정수를 쓴다. **매핑을 여기서 고정한다.**

| UI | `condition` 저장값 | `conditionAdjust` | FI 기여 `(5−c)/4×0.2` |
| --- | --- | --- | --- |
| 피곤함 | **1** | −3 | 0.20 |
| 보통 | **3** | 0 | 0.10 |
| 가벼움 | **5** | +2 | 0.00 |

- 2·4는 **사용하지 않는다.** DB `CHECK (condition BETWEEN 1 AND 5)`는 확장 여지로 남겨둔다
- 미입력(수기 기록 등)은 **3(보통)** 으로 간주 (§12 FI 참조)
- 이 매핑이 없으면 FE가 보낸 값과 BE의 FI 계산이 바로 어긋난다

### 화면에는 범위를 노출하지 않는다
사용자에게는 **중심값 하나**만 보여준다. 메트로놈도 center BPM으로 울린다.

| | 표기 |
| --- | --- |
| 화면·음성 | `오늘의 리듬 157` |
| 내부 판정 | `153 ~ 161` |
| 하향 안내 | `목표를 152로 낮췄어요` |

범위 안/밖은 숫자가 아니라 **현재 리듬 숫자의 색**으로 표현한다.
정확히 157을 맞추는 건 불가능하므로, "틀렸다"는 인상을 주면 안 된다.

DB·API는 `target_cadence_min/max`가 원본. center는 표시 시 `(min+max)/2`로 계산한다 (±4 대칭이라 항상 정수).

## 4. 측정 사이클
```
1초 타이머 : 누적 걸음 차분 → 순간 SPM
20초 윈도우: 중앙값 → 판정용 cadence
5초 tick   : 판정 + samples push
```
- `watchStepCount` 콜백에서는 누적값만 갱신 (호출 빈도 불규칙).
- 워밍업 90초: tick은 돌되 판정 결과 무시, 샘플 저장은 진행.
- 윈도우 cadence `< 50` → **정지**. 판정 제외, 이탈 카운터 유지(리셋하지 않음).
- 윈도우 cadence `50~120` → **걷기**. 이탈 판정 안 함. 단 60초 지속 시 downshift 트리거(§7).
- 윈도우 cadence `> 120` → **러닝**. 정상 판정.

정지 임계값을 50으로 둔 이유: 걷기 케이던스가 100~120이라, 100으로 자르면 걷는 사람이 정지로 잡힌다.

## 5. 판정 타임라인
| 구간 | `TOO_FAST` | `TOO_SLOW` | Downshift |
| --- | --- | --- | --- |
| 0 ~ 90초 | ✕ | ✕ | ✕ |
| 90초 ~ 5분 | **○** | ✕ | ✕ |
| 5분 이후 | ○ (2회 소진 전) | ○ | `TOO_SLOW`·걷기만 |
| 목표 90% 이후 | ✕ | ○ | ○ |
| 리커버리 진입 후 | ✕ | ✕ | ✕ |

초반에 `TOO_FAST`만 켜는 이유: 페르소나의 핵심 문제가 *"빠르게 시작 → 10분 후 지쳐 걸음"*이다.
초반 과속은 이 앱이 존재하는 이유고, 초반 저속(몸 풀기)은 아무도 피해를 보지 않는다.
5분 이전에 `TOO_SLOW`를 켜면 몸 푸는 사용자를 재촉하고, 이어서 목표까지 낮추는 역주행이 일어난다.

## 6. 상태머신

### 세션 (`runStore`)
```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> RUNNING : 시작
    RUNNING --> PAUSED
    PAUSED --> RUNNING
    RUNNING --> [*] : 수동 종료
    PAUSED --> [*] : 수동 종료
```
**`CALIBRATING` 상태는 없다.** 첫 러닝도 `RUNNING`으로 바로 들어간다 (§2).
완주해도 자동 종료 없음(알림만). `PAUSED` 중 타이머·판정·샘플링 정지, `PAUSE`/`RESUME` 이벤트 기록.

### 시간은 wall-clock을 쓰지 않는다 ⚠️
엔진 안에서 **`Date.now()` / `setTimeout` / `setInterval`로 시간을 재지 않는다.**
모든 시간 판정은 tick으로 전달된 **경과 초(`elapsedSec`)** 기준으로만 한다.

```ts
// ✗ 금지
setTimeout(() => endCooldown(), 60_000)

// ○ 이렇게
judge({ elapsedSec, cadence })   // 내부에서 elapsedSec - cooldownStartedAt >= 60 판정
```

이유가 둘이다.
- **`ReplaySource`가 배속으로 돌 때 판정 시간이 같이 배속되어야 한다.** wall-clock을 쓰면
  샘플만 빨리 흐르고 쿨다운·이탈 지속·하향 간격은 현실 시간으로 남아 시뮬레이션이 깨진다
- 백그라운드에서 타이머가 지연·병합되어도 경과 초는 정확하다

시간을 만드는 곳은 `CadenceSource` **한 곳뿐**이다. 엔진은 받은 숫자로만 판단한다.

```ts
interface CadenceSample { elapsedSec: number; cadence: number; pace?: number; dist?: number }
interface CadenceSource { start(cb: (s: CadenceSample) => void): void; stop(): void }
```

`ReplaySource(samples, speed)`는 `speed`만큼 빠르게 같은 `elapsedSec`을 흘려보낸다.
엔진 코드는 한 줄도 바뀌지 않는다.

### 판정 (`judge`)
```mermaid
stateDiagram-v2
    [*] --> WARMUP
    WARMUP --> IN_RANGE : 90초 경과
    IN_RANGE --> DEVIATING : 범위 밖
    DEVIATING --> IN_RANGE : 회복(±3)
    DEVIATING --> INTERVENED : 20초(일반) / 10초(급격)
    INTERVENED --> COOLDOWN : 오디오 종료
    COOLDOWN --> IN_RANGE : 60초 후 중심 ±3 진입
    COOLDOWN --> FAILED : 60초 후 중심 ±3 밖
    FAILED --> DEVIATING : 트리거 미만
    FAILED --> DOWNSHIFT : 트리거 충족 & 하향 잔여 있음
    FAILED --> RECOVERY : 트리거 충족 & 하향 소진
    DOWNSHIFT --> IN_RANGE : 새 범위 적용
    DOWNSHIFT --> RECOVERY : 하한 130 도달
    RECOVERY --> [*] : 종료까지 유지
```

## 7. 이탈 · 개입
- 급격 이탈(±10 초과, 10초)이 일반(±4, 20초)보다 먼저 발화.
- 개입 오디오: 음성 ≤3초 1문장 + 메트로놈 5초 (설정별 on/off).
- **음성·메트로놈 모두 off인 경우 햅틱 1회** (`expo-haptics`). 아무 피드백도 없으면 앱이 죽은 것처럼 보인다.
- 쿨다운 60초: 무음 + 판정 보류.
- 재개입: 쿨다운 후 **반대 방향 이탈일 때만**. 같은 방향 지속은 실패 카운트.

### 실패 후에는 이탈 타이머를 다시 센다

"재개입은 반대 방향일 때만"은 **쿨다운이 끝나는 그 순간**의 규칙이다. 같은 방향이면
그 시점에 다시 말하지 않고 실패로 세고 `DEVIATING`으로 돌아간다(§6 상태머신의
`FAILED → DEVIATING` 경로). 거기서 이탈 지속 시간을 **0부터 다시 세고**,
20초(급격 10초)를 채우면 그때 다시 개입한다.

이 문장이 없으면 같은 방향 실패가 2회 쌓일 수 없어 §8의 `실패 2회 → downshift`에
영원히 도달하지 못한다. `DEMO.md`의 *"안내 뒤에도 회복이 안 되면 목표를 낮춘다"*가
성립하는 근거가 여기다.

### `TOO_FAST` — 개입만, downshift 없음
| 회차 | 문구 | 이후 |
| --- | --- | --- |
| 1 | "지금 리듬이 조금 빠릅니다. 보폭을 줄이고 편하게 달려볼까요?" | 쿨다운 60초 |
| 2 | "조금만 천천히 가도 괜찮아요." | **이후 세션 내 완전 침묵** |

**`TOO_FAST`에 downshift를 걸면 악순환이 된다.** 목표보다 빠른 사용자에게 목표를 낮추면
격차가 더 벌어지고, 개입이 잦아지고, 하향 횟수만 소진된다.

`TOO_FAST`가 안 고쳐지는 이유는 두 가지인데 **러닝 중에는 구분할 수 없다.**
- 흥분해서 과속 중 → 후반에 무너짐
- baseline이 낮게 잡힘 → 아무 문제 없음

구분하려면 후반 하락 여부를 봐야 하고, 그건 러닝이 끝나야 안다.
따라서 **러닝 중에는 2회만 알리고 침묵**, 판단은 리포트가 한다(§2 세션 간 업시프트).

### 이벤트
| 상황 | `events[].type` | payload |
| --- | --- | --- |
| 시작 | `RUN_START` | `{min, max}` |
| 과속 개입 | `TOO_FAST` | `{cadence}` |
| 저속 개입 | `TOO_SLOW` | `{cadence}` |
| 목표 하향 | `TARGET_ADJUSTED` | `{min, max, reason}` |
| 리커버리 진입 | `RECOVERY_MODE_ON` | `{reason}` |
| 일시정지/재개 | `PAUSE`/`RESUME` | `{}` |
| 종료 | `RUN_END` | `{completed}` |

`TARGET_ADJUSTED.reason`: `no_recovery` \| `severe` \| `walking`
`RECOVERY_MODE_ON.reason`: `downshift_exhausted` \| `floor_reached`

> `STABLE` 이벤트는 제거했다. Rhythm Score가 같은 정보를 담고 있고,
> 러닝 중 긍정 피드백은 Silent-by-default와 충돌한다.

## 8. Downshift
실패 = 쿨다운 60초 종료 시점에도 범위 밖. **`TOO_SLOW` 방향만 카운트한다.**

| 트리거 | 조건 |
| --- | --- |
| 일반 이탈(느림) | 실패 2회 |
| 급격 이탈(느림) | 실패 1회 |
| 걷기 60초 지속 | 즉시 |

### 하향폭 계산 — 1회당 최대 −5

```
runSamples = 직전 60초 샘플 중 cadence > 120 인 것만   ← 걷기·정지 제외
candidate  = runSamples.length >= 4 ? median(runSamples) : currentCenter - 5
newCenter  = clamp(candidate, currentCenter - 5, currentCenter)   ← 한 번에 최대 −5
newCenter  = max(newCenter, 130)
newMin/Max = newCenter ∓ 4
```

| 상수 | 값 |
| --- | --- |
| `MAX_DOWNSHIFT_STEP` | **5 spm** (1회당) |
| `DOWNSHIFT_MEDIAN_MIN_SAMPLES` | 4개 (60초 / 5초 tick의 절반) |

**두 가지 장치가 함께 작동한다.**

**① 걷기·정지 샘플을 median에서 뺀다 — 변동이 큰 사용자 대응의 핵심.**
걷다 뛰다 반복하면 60초 중앙값이 걷기 쪽(100 근처)으로 끌려간다.
그 값으로 목표를 잡으면 걷는 것이 "목표 달성"이 되어 판정이 무너진다.
**"이 사람이 달릴 때 유지하는 리듬"**만 봐야 하므로 러닝 샘플(`> 120`)만 쓴다.

**② 1회당 −5 상한.** median이 아무리 낮게 나와도 한 번에 5 이상 떨어지지 않는다.
`165 → 132`처럼 한 번에 무너지지 않고 `165 → 160 → 155`로 단계적으로 내려간다.

걷기 60초로 트리거된 경우엔 러닝 샘플이 거의 없으므로 **고정 −5**가 적용된다.
이 장치가 없으면 *걷기 = 즉시 130 = 리커버리 진입 버튼*이 되어,
한 번 걷는 순간 러닝이 사실상 종료되는 동작이 된다.

### 실행 규칙
- **세션당 최대 2회 실행.** 2회를 모두 쓴 뒤 3번째 하향 조건이 충족되면 downshift 대신 **리커버리 진입**.
- 하한 130에 도달한 경우 횟수와 무관하게 **즉시 리커버리 진입**.
- 하향 후 5분 금지, 새 범위 30초 유지 시 안정화.
- **원래 목표 복귀 없음.** 하향 범위가 최종 목표.
- 기록: `TARGET_ADJUSTED` 이벤트 + `runs.final_target_min/max` 갱신.

> 세션당 최대 −10이므로 하한 130에 실제로 닿으려면 시작 목표가 140 이하여야 한다.
> 즉 **대부분의 러닝에서 리커버리는 "하향 2회 소진" 경로로 진입**하고,
> 하한 도달 경로는 애초에 목표가 매우 낮았던 예외 상황에서만 발생한다.
> 변동이 극심한 사용자는 2회를 빠르게 소진하고 리커버리로 가는데, **그게 의도된 귀결이다.**

## 9. 리커버리 모드
```
진입: 3번째 하향 조건 충족(하향 2회 소진) 또는 하한 130 도달
동작: 안내 1회 → 러닝 종료까지 개입 없음
해제: 없음. 세션 종료까지 유지
```
- 안내 문구: **"지금은 회복이 우선이에요. 편하게 걸으셔도 괜찮아요."**
- 이후 `TOO_FAST`·`TOO_SLOW`·downshift 전부 발동하지 않음
- **측정·샘플링·기록은 계속한다.** 이 구간의 낮은 케이던스가 FI에 반영되어야
  다음 러닝 목표가 제대로 낮아진다
- `RECOVERY_MODE_ON` 이벤트 기록

여기서 목표를 더 낮추지 않는 이유: 하한 130 부근은 이미 걷기 상단(120)에 근접해 있다.
더 낮추면 걷는 것을 "목표 달성"으로 판정하게 되고 목표라는 개념이 무너진다.
**"더 낮춘다"에서 "그만 말한다"로 축을 바꾸는 것이 맞다.**

리포트에서 이 러닝을 실패로 표현하지 않는다 — 페르소나의 Pain Point가
*"목표를 달성하지 못하면 러닝 자체를 실패로 느낀다"*이다. 캘린더 완료 표시와 `달리 데이`는 동일하게 적용한다.

## 10. 완주 · 예외
| 상황 | 동작 |
| --- | --- |
| 목표 도달 | 알림만, 자동 종료 없음. **이후 `TOO_FAST` 개입 중지**(막판 스퍼트 허용) |
| GPS 미수신 | 케이던스 로직 정상, `distance_m`·`avg_pace_sec_per_km` = null |
| 거리 목표 + GPS 미수신 | 시간 목표 전환 폴백 안내 |
| 백그라운드 | 무음 루프로 세션 유지, 판정 계속 |

## 11. 구현
- 센서: `Pedometer.watchStepCount()` 최우선.
- 오디오 세션: `MixWithOthers` + `staysActiveInBackground`. 외부 플레이리스트 중단 금지 (`DuckOthers`는 개입 순간만).
- 백그라운드 생존: 무음 루프 상시 재생 → `UIBackgroundModes: ["audio"]`.
- `CadenceSource` 인터페이스로 `PedometerSource` / `ReplaySource` 분리. **데모는 ReplaySource — 1일차에 구현.**
- `samples` push 5초 간격.

`engine/types.ts`에 들어갈 것 (UI FE 유일 접점): `RunState`, `JudgeVerdict`, `CadenceSample`, `RunEvent`, `TargetRange`, `CadenceSource`. 상수는 `engine/constants.ts`.

## 12. 서버 연산 (BE 소유)
러닝 중 판정 = 온디바이스 / 러닝 후 지표 = 서버. 구현: `server/app/services/metrics.py`.

### Rhythm Score
```
분모 = 전체 러닝 시간 − 사용자 pause   (워밍업 포함, 정지 구간 포함)
분자 = 그 중 목표 범위 안에 있던 시간
```
- **정지 구간을 포함하는 이유**: 신호대기든 뭐든 멈췄으면 리듬이 깨진 것이다.
  사용자가 pause를 명시적으로 누른 구간만 "러닝이 아니다"로 인정한다.
- 다운시프트 이후 구간은 **그 시점의 새 범위**로 판정한다.
  처음 목표로 전 구간을 재면 낮출수록 점수가 나빠져, "목표를 낮춰 잘 따라간" 러닝이 실패로 기록된다.
- 화면 문구는 "안정 구간 61%". *"157을 61% 유지"*는 성립하지 않는 표현이므로 쓰지 않는다.

### Late Run Cadence Drop Rate
```python
def late_drop_rate(samples, duration_sec) -> float | None:
    if duration_sec < 360:                                   # 6분 미만
        return None
    valid = [s for s in samples if s.t >= 90 and s.c >= 50]  # 워밍업·정지 제외
    if len(valid) < 30:
        return None
    n = len(valid) // 3
    early = median([s.c for s in valid[:n]])
    late  = median([s.c for s in valid[-n:]])
    if early <= 0:
        return None
    return max(0.0, min(1.0, 1 - late / early))
```
- **워밍업 90초를 반드시 제외한다.** 의도적으로 느린 구간이라 포함하면 전반 평균이 내려가고,
  후반 하락이 실제보다 작게 나온다.
- **정지(`< 50`)는 제외, 걷기(`50~120`)는 포함.** 걷기는 피로의 증거라 반영되어야 한다.
- RS와 달리 정지를 제외하는 이유: RS는 시간 비율이라 균일하게 깎이지만,
  LDR은 구간 중앙값이라 정지 샘플이 섞이면 값이 통째로 왜곡된다. **이 비대칭은 의도된 것이다.**
- 평균이 아니라 **중앙값**. baseline 산출과 일관되고 튀는 값에 덜 흔들린다.
- 앞 1/3 vs 뒤 1/3만 사용. 중간 구간은 쓰지 않는다.

### Fatigue Index
```python
def fatigue_index(rs, ldr, condition) -> float | None:
    if rs is None or ldr is None:
        return None
    cond = condition if condition is not None else 3   # 미입력 시 '보통'
    fi = (1 - clamp01(rs)) * 0.4 + clamp01(ldr) * 0.4 + (5 - cond) / 4 * 0.2
    return clamp01(fi)
```
이론상 이미 0~1이지만 각 항과 최종값 모두 클램프한다. 비용 0, 방어 확실.

**화면에는 소수를 노출하지 않는다.**

| FI | 라벨 |
| --- | --- |
| `< 0.35` | 여유로움 |
| `0.35 ~ 0.6` | 보통 |
| `≥ 0.6` | 부담됨 |

폴백 문구 분기도 같은 경계값을 쓴다. D-3 야외 테스트 후 실측을 보고 경계를 조정할 것.

### 다음 목표 추천
완주 여부·안정성·개입 횟수·후반 변화 기반. **AI 리포트 응답에 포함**(별도 API 없음).
세션 간 업시프트 조건(§2)을 만족하면 `next_target`을 `+2`로 올린다.
