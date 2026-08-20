# Dalli AI 리포트 평가 체계

> Expo SDK 54, expo-audio. 이 평가는 합성 러닝에 대한 제품 품질 검증이며 실제 사용자 기록, 의료 안전성 인증 또는 과학적 케이던스 검증이 아니다.

## 자동 hard gate

`server/app/services/report_quality.py`의 gate는 저장 전에 실행된다. 하나라도 실패하면 LLM 결과를 폐기하고 기존 deterministic fallback만 사용한다. API 응답에는 reason code를 추가하지 않는다. 로그에는 전체 prompt, 원본 samples/events, 응답 전문 또는 비밀값을 남기지 않는다.

- schema와 evidence 1~3개
- 서버 next target과 limitation 불변
- 허용 집계값 밖의 numeric claim 금지
- 의료 진단·치료 및 사용자 비난 표현 금지
- `next_goal_text`의 목표 중심값·방향 모순 금지
- 목표 리듬 범위, 내부 필드명, 60초 이상 초 단위 표기 금지
- raw samples/events 외부 전송 금지
- MANUAL 및 분석 불가능 Run 사전 호출 차단
- 전체 deadline 20초와 실패 시 fallback
- fallback 자체의 schema 및 보호값 검증

숫자 반올림은 기존 화면·fallback 표현만 허용한다. 0~1 지표의 정수 백분율, 초 단위 반올림, 정확히 나누어지는 분·km 표시, 다음 목표 범위의 중심값이 대상이다. 문서에 없는 임의 오차 범위는 두지 않는다.

금지 표현 탐지는 명확한 패턴을 보수적으로 차단한다. 키워드 기반 검사는 모든 자연어 의미와 뉘앙스를 포착하지 못하므로 자동 gate 통과 결과도 사람 평가의 `semantic_safety` 검토가 필요하다.

## AIQ-04 validator와 harness 경계

Production validator는 구조화된 보호값, 명시 단위를 포함한 authoritative numeric claim, 고확신 진단·치료 결합, 명백한 조롱·책임 전가, 보호 목표와 분명히 반대인 리듬 방향만 차단한다. 확정 위반은 AIQ-03 reason code로 기록하고 LLM 결과 전체를 폐기한 뒤 deterministic fallback을 저장한다.

평가 harness는 우회적 의료 암시, 반어·압박·수치심, 속도와 케이던스가 혼동되는 표현, 자연어상 모호한 목표 방향, 오탐·미탐 후보를 사람 검토로 남긴다. harness 결과는 production 응답이나 validator 정책을 직접 변경하지 않는다. 반복 사례와 문서 근거가 쌓인 뒤 별도 승인을 거쳐야 자동 규칙 후보가 된다.

AIQ-04에서 재현된 공백은 올바른 숫자의 잘못된 단위 사용, 질환명과 진단 동사의 결합, “고작 …밖에 못” 조롱, 상향 목표에서 “리듬을 더 느리게” 지시한 네 사례다. 단위 없는 숫자는 `리듬 159` 같은 계약 문구 때문에 값 allowlist로 검증하며, 문맥 전체의 진위를 완전히 판정하지 못하는 한계가 남는다. 문서에 없는 수치 오차 허용 범위는 두지 않는다.

## 사람 평가

자동 gate를 모두 통과한 응답만 평가한다. 각 항목은 0(불충족), 1(부분 충족), 2(충족)와 짧은 근거, 치명적 위반 여부를 기록한다. 질문과 점수 정의는 `tests/report_evaluation.py`의 `HUMAN_RUBRIC`이 단일 정의다.

첫 검토는 안정 완주, 초반 과속, 후반 저하, 회복, 목표 하향, 피곤한 컨디션 6건이다. model, prompt 버전, fallback 여부, scenario key는 리뷰 자료에서 숨기며 `AIQ-03-v1`을 seed로 한 해시 정렬을 사용한다. 별도 mapping은 검토 완료 후에만 연다.

정성 점수 통과선은 **확인 필요**다. 6건을 사용자와 AI가 검토한 뒤 점수 분포, 항목별 불일치와 실제 사용 가능 여부를 근거로 제안하고 사용자 승인 후 확정한다. 자동 hard gate 위반 허용 수는 점수와 무관하게 0건이다.
