# AIQ-05 usage·비용 평가 harness

Expo SDK 54, `expo-audio` 환경의 AI 리포트 평가는 production DB/API와 분리된
evaluation-only 경로에서 수행한다. 이 문서는 구현된
`app/services/usage_harness.py`와 fake 테스트의 단일 운영 규칙이다.

## 고정 예산과 승인 게이트

- 1차 실제 호출은 6회, 조건부 반복은 추가 6회로 총 최대 12회다.
- 현재 configured model인 `gpt-4o-mini`를 먼저 평가한다. 비교 모델은 기본 평가가
  실패하고 별도 승인을 받은 경우에만 동일한 데이터·prompt·JSON Schema로 평가한다.
- 실제 비용은 OpenAI Dashboard에서 확인한다. Costs API 호출은 사용하지 않는다.
- 개발용 키는 커밋되지 않는 `server/.env`의 `OPENAI_API_KEY`에만 둔다. 테스트와
  preflight는 키를 읽거나 출력하지 않으며, 기본값은 실제 호출을 허용하지 않는다.
- 리포트 전문은 사용자+AI 정성 검토 자료로 보관한다. 단, attempt JSONL에는
  계약의 9개 구조화 필드만 넣고 prompt, raw samples/events, key, 운영 payload는 넣지 않는다.

현재 설정의 기본 모델은 `gpt-4o-mini`, 전체 deadline은 `llm_timeout_sec` 최대 8초,
Responses 요청의 `max_output_tokens`는 600이다. 평가 observer는 기존
`generate_llm_report()` 경계에서 응답 객체를 메모리로만 전달하며, production Report
저장 경로나 API 응답을 바꾸지 않는다.

`build_preflight()`의 `live_execution_allowed=False`가 사전 승인을 표현한다.
`max_attempts=12`, cost cap, 알려진 pricing이 모두 만족되고 명시적으로 허용된 경우에만
`enforce_preflight()`가 통과한다. 초과·미확인 가격·미승인 호출은 모두 사전 차단한다.

## Usage와 비용

현재 설치된 OpenAI SDK `3.1.0`의 Responses usage 필드만 읽는다.

- `input_tokens`
- `input_tokens_details.cached_tokens`
- `output_tokens`
- `output_tokens_details.reasoning_tokens` (참고용, 현재 비용 합산에서 제외)
- `total_tokens`

Harness 내부 상태 enum은 usage의 `available/partial/missing/invalid`, 비용의
`available/unknown`, 시도의 `completed/incomplete/timeout/provider_error/schema_failed/
validator_failed/evaluator_error/usage_invalid`을 사용한다. API가 반환한
`response_status`는 이 enum과 별도 원문 값으로 보존한다.

누락·부분·합계 불일치·cached > input은 각각 `missing`, `partial`, `invalid`로 남기며
비용을 추정해 채우지 않는다. 비용은 `Decimal`로 계산하고 uncached input, cached input,
output을 분리한다. 가격표는 공식 [gpt-4o-mini 모델 페이지](https://developers.openai.com/api/docs/models/gpt-4o-mini)를
2026-08-16에 확인한 값(입력 $0.15/M, cached 입력 $0.075/M, 출력 $0.60/M)으로
`pricing_id`와 함께 기록한다. 다른 모델은 가격표를 추가하기 전 `pricing_unknown`으로
차단한다.

## Attempt record와 안전성

각 attempt는 고정 `evaluation_run_id`, `scenario_id`, `attempt_index`, 요청·실제 모델,
prompt 버전, UTC 시작/종료·elapsed, response status/completed/truncation 상태,
fallback·hard gate 결과, reason code, SDK response/request id(있을 때만), usage,
적용 단가, 시도 비용, 누적 확인 비용과 usage 미확인 예약 상한, pricing id, 사람 평가 대상
여부를 기록한다. 응답 status가 `incomplete`이고 SDK reason이
`max_output_tokens` 또는 `token_limit`일 때만 truncation을 `known=true`로 표시하며,
그 외에는 `unknown`으로 둔다.

`AttemptJsonlWriter`는 테스트가 지정한 경로에만 append한다. 기본 production 경로·DB
저장은 없고, JSONL 생성물은 평가 보존 기간과 접근 권한을 별도로 정해야 한다(`확인 필요`).
`write_evaluation_summary()`는 attempt JSONL과 분리된 집계 요약(확인 비용, usage 미확인
시도 수, 누적 상한, 상태 수)만 기록한다.

## AIQ-06 runner

`tests/aiq06_runner.py`가 고정된 6개 baseline 시나리오를 이 harness에 연결한다.
기본 실행은 preflight만 출력하고 외부 호출을 하지 않는다. 실제 호출은 로컬 개발 키와
`LLM_ENABLED=true`가 설정된 상태에서 `--allow-live`와 명시적인 `--output-dir`를 함께
지정해야 한다. 출력 디렉터리에는 `preflight.json`, 안전한 `attempts.jsonl`, 집계
`summary.json`, 사람 평가용 `blind_materials.json`, 사후 대조용 `blind_mapping.json`만
생성되며 prompt·raw samples/events·키·운영 DB/API payload는 저장하지 않는다.

```powershell
python -m tests.aiq06_runner
python -m tests.aiq06_runner --allow-live --output-dir <evaluation-dir>
```

첫 명령은 항상 미승인 preflight로 종료한다. 두 번째 명령은 최대 12회·기본 비용 상한
`$0.01`·현재 모델 가격표를 모두 통과할 때만 6회 호출한다.

## Fake 우선 실행

`tests/test_usage_harness.py`는 성공, usage 누락/부분/불일치, truncated response,
timeout/provider error, schema·validator failure용 record, unknown pricing, cost cap,
preflight 및 JSONL 비밀/원본 누출 방지를 검증한다. 실제 OpenAI 요청은 이 테스트에서
발생하지 않는다. 라이브 실행 harness 연결은 사용자의 별도 승인이 있을 때만 다음 단계에서
추가한다.
