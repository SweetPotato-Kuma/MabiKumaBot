# Mabinogi Kuma Bot

`mabinogi-kuma-bot`은 Nexon Open API의 마비노기 경매장 데이터를 조회해 Discord에서 가격 알림을 보내는 JavaScript Discord 봇입니다.

discord.js v14 방식의 슬래시 명령어를 사용하며, 모든 기능은 `/구마` 명령어 안의 버튼 UI로 관리합니다.

## 기능

- Nexon Open API 마비노기 경매장 키워드 검색 사용
- `마나허브`처럼 공백 없이 입력해도 `마나 허브` 같은 실제 경매장 아이템명으로 검색
- 사용자별 모니터링 아이템 목록 저장
- 사용자별 알림 채널 저장
- 사용자별 알림 기준 저장: 기준가(차순위 가격)보다 `10~100%` 이상 낮을 때 알림
- 체크 간격 커스텀, 기본값 `10초`
- 목록 화면에서 `1. 아이템 X` 형태의 버튼으로 바로 삭제
- 많은 목록은 이전/다음 버튼으로 페이지 이동
- 같은 아이템의 반복 알림을 줄이기 위한 쿨다운 적용

## 요구 사항

- Node.js 22.12.0 이상
- Discord Bot Token
- Nexon Open API Key

## 설치

```bash
npm install
```

## 환경 설정

프로젝트 루트의 `.env`에 값을 채워 주세요.

```env
TOKEN=디스코드_봇_토큰
API_KEY=넥슨_Open_API_키
```

선택 환경 변수:

- `DISCORD_CLIENT_ID`: `npm run deploy:commands`를 직접 실행할 때 사용할 Discord 애플리케이션 ID
- `DISCORD_GUILD_ID`: 개발 서버에만 명령어를 즉시 등록하고 싶을 때 사용할 Discord 서버 ID
- `DISCORD_BOT_TOKEN`: `TOKEN` 대신 사용할 Discord 봇 토큰 변수명
- `MABINOGI_API_KEY`: `API_KEY` 대신 사용할 Nexon Open API 키 변수명
- `DISCORD_CHANNEL_ID`: 시작 시 사용할 기본 알림 채널 ID. 이후 `/구마`에서 사용자별 채널로 덮어쓸 수 있습니다.
- `MABINOGI_ITEMS`: 데이터 파일이 없을 때 최초로 가져올 아이템 목록
- `CHECK_INTERVAL_SECONDS`: 가격 체크 간격, 기본값 `10`
- `REQUEST_TIMEOUT_SECONDS`: Nexon API 요청 타임아웃, 기본값 `10`
- `ALERT_DISCOUNT_THRESHOLD`: 기본 알림 기준. `0.1`이면 10% 이상 낮을 때 알림
- `ALERT_COOLDOWN_SECONDS`: 같은 사용자/아이템 반복 알림 쿨다운, 기본값 `3600`
- `AUTO_DEPLOY_COMMANDS`: 봇 시작 시 명령어 자동 등록 여부, 기본값 `true`

## 실행

```bash
npm start
```

Windows에서는 실행기를 사용할 수 있습니다.

- `start-bot.bat`: 봇 시작
- `stop-bot.bat`: 봇 종료

실행 로그는 `bot.log`, 오류 로그는 `bot.err`에 기록됩니다. 이미 실행 중이면 `start-bot.bat`은 중복 실행하지 않습니다.

## 명령어

`/구마` 하나만 사용합니다.

- 아이템 추가
- 목록/삭제
- 가격 확인
- 이 채널로 알림
- 알림 기준: 10~100 사이 정수를 입력해 내 알림 기준 설정
- 체크 간격
- 상태

이제 목록과 알림 기준은 Discord 사용자별로 분리됩니다. 예를 들어 A 사용자가 등록한 아이템은 A에게만 보이고, B 사용자가 등록한 아이템은 B에게만 보입니다.

기존 전역 `data/items.json` 목록이 남아 있는 경우, 첫 번째로 `/구마`를 사용한 Discord 사용자에게 자동 승계됩니다.

## Discord 봇 권한

슬래시 명령어 기반이라 Message Content Intent는 필요하지 않습니다.

초대 URL 생성 시 권장 설정:

- Scopes: `bot`, `applications.commands`
- Bot Permissions: `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`

## systemd 예시

Linux 서버에서 장기 실행하려면 `systemd/mabinogi-kuma-bot.service`를 참고해 경로와 사용자 환경에 맞게 수정하세요.

## 참고

- [discord.js 14.26.4 문서](https://discord.js.org/docs/packages/discord.js/14.26.4)
- [Nexon Open API](https://openapi.nexon.com/)
