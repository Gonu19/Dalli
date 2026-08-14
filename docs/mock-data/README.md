# API mock data

프론트가 서버 구현 전 화면과 API 상태를 개발하기 위한 고정 fixture다.

- 파일: `api-fixtures.json`
- 형식: 각 시나리오에 `{ "status": number, "body": object }`
- 단일 진실: 상위 `CONTRACT.md`
- 날짜와 UUID는 테스트 재현성을 위해 고정돼 있다.
- 토큰은 목 문자열이며 실제 인증에 사용할 수 없다.

실서버 OpenAPI가 나온 뒤 fixture를 갱신할 때는 기존 키를 가능하면 유지한다.
