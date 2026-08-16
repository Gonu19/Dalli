# API mock data

프론트가 서버 구현 전 화면과 API 상태를 개발하기 위한 고정 fixture다.

- 파일: `api-fixtures.json`
- 형식: 각 시나리오에 `{ "status": number, "body": object }`
- 단일 진실: 상위 `CONTRACT.md`
- 날짜와 UUID는 테스트 재현성을 위해 고정돼 있다.
- 토큰은 목 문자열이며 실제 인증에 사용할 수 없다.

실서버 OpenAPI가 나온 뒤 fixture를 갱신할 때는 기존 키를 가능하면 유지한다.

## 실행 가능한 Mock API

PostgreSQL과 OpenAI를 연결하지 않고 프론트 요청에 응답한다.

```powershell
cd server
python -m pip install -r requirements-dev.txt
python -m uvicorn app.mock_main:app --host 0.0.0.0 --port 8001
```

- PC 확인: `http://localhost:8001/docs`
- 로컬 아이폰 임시 확인: `http://<PC-LAN-IP>:8001`
- 로컬 확인 시 아이폰과 PC는 같은 Wi-Fi에 연결하고 Windows 방화벽에서
  Python/8001 인바운드를 허용해야 할 수 있다.
- 프론트 통합용 확정 `EXPO_PUBLIC_API_URL`은 EC2 Nginx가 제공하는 HTTPS 주소다.
  Mock과 실 API 전환 시 이 주소를 바꾸지 않는다.
- 이 서버는 메모리 상태만 사용하며 재시작하면 초기화된다.
- PostgreSQL과 OpenAI를 전혀 호출하지 않는다.

리포트 시나리오는 Mock 전용 헤더로 바꿀 수 있다.

```text
X-Mock-Scenario: normal
X-Mock-Scenario: fallback
X-Mock-Scenario: insufficient_data
```

세 시나리오는 모두 HTTP 200이다. `normal`은 `is_fallback=false`, `fallback`은
`is_fallback=true`, `insufficient_data`는 `is_fallback=true`와 비어 있지 않은
`limitation` 및 `null` 지표를 반환한다. 같은 `run_id`로 리포트를 재요청하면
최초 생성 결과를 그대로 반환하므로 시나리오를 바꿔 재전송해도 결과가 바뀌지 않는다.

러닝 업로드도 `(사용자, client_run_id)` 계약을 흉내 내며, 같은
`client_run_id`를 재전송하면 최초 201 응답과 동일한 body를 200으로 반환한다.

화요일 실서버 연결 이후에는 같은 HTTPS 진입점의 내부 업스트림을
`app.mock_main`에서 `app.main`으로 전환하고 이 헤더를 제거한다.
