# EC2 배포 체크리스트

IN-01과 IN-02는 BE가 같은 EC2 인스턴스에서 연속 수행한다. 외부 HTTPS Base URL과
Nginx 업스트림 `127.0.0.1:8000`은 Mock과 실 API에서 동일하다.

## 서버 제공 전에 확정할 값

- Ubuntu EC2의 SSH 접속 정보
- API 도메인과 EC2를 가리키는 DNS A/AAAA 레코드
- 보안 그룹 인바운드: SSH는 허용된 관리 IP, HTTP/HTTPS는 80/443
- `server/.env`에 직접 입력할 `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`

실제 비밀값은 저장소, 셸 기록, 이 문서에 넣지 않는다.

## 서버 제공 후 IN-01

1. OS 패키지를 갱신하고 Docker Engine, Compose plugin, Nginx, Certbot을 설치한다.
2. `swapon --show`와 `free -h`로 기존 swap을 확인한 뒤, 없을 때만 2GB swap 파일을
   만들고 `/etc/fstab`에 한 번만 등록한다.
3. `deploy/nginx/dalli.conf.template`의 `__API_DOMAIN__`을 실제 도메인으로 치환해
   `/etc/nginx/sites-available/dalli`에 설치하고 활성화한다.
4. `nginx -t` 통과 후 Nginx를 reload한다.
5. DNS 전파와 HTTP `/health`를 확인한 뒤 Certbot Nginx plugin으로 인증서를
   발급한다. 자동 갱신은 `certbot renew --dry-run`으로 확인한다.

애플리케이션과 PostgreSQL 포트는 루프백에만 바인딩한다. 외부에는 Nginx의
80/443만 노출한다.

## Mock 배포

저장소 루트의 `docs/mock-data`가 읽기 전용으로 컨테이너에 마운트된다.

```bash
cd server
docker compose -f docker-compose.mock.yml up -d --build
docker compose -f docker-compose.mock.yml ps
curl --fail http://127.0.0.1:8000/health
curl --fail https://<api-domain>/health
```

프론트에는 마지막 HTTPS 주소만 전달한다.

## 실 API 전환

서버와 `dalli_test` 검증이 끝난 뒤에만 전환한다. 두 Compose를 동시에 실행하면
같은 루프백 포트가 충돌하므로 Mock을 먼저 중지한다.

```bash
cd server
docker compose -f docker-compose.mock.yml down
docker compose up -d --build
curl --fail http://127.0.0.1:8000/health
curl --fail https://<api-domain>/health
```

Nginx 설정과 프론트의 `EXPO_PUBLIC_API_URL`은 변경하지 않는다. 실 API E2E가
실패하면 실 DB를 초기화하지 말고 원인을 확인한 뒤 Mock으로 되돌린다.
