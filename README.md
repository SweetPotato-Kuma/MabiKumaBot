# Mabinogi Kuma Bot

`mabinogi-kuma-bot`은 마비노기 경매장 가격을 모니터링하고, 최저 등록가가 차순위 가격보다 크게 낮을 때 Discord 채널로 알려주는 JavaScript Discord 봇입니다.

discord.js v14 방식에 맞춰 슬래시 명령 기반으로 구성했습니다.

## 기능

- Nexon Open API 마비노기 경매장 키워드 검색 사용
- 등록된 아이템의 최저가와 차순위 가격 주기적 비교
- 최저가가 차순위 가격의 `ALERT_DISCOUNT_THRESHOLD` 이하이면 Discord 알림 전송
- `/추가`, `/제거`, `/목록`, `/상태`, `/가격확인`, `/알림채널` 슬래시 명령 지원
- `/구마` 버튼 UI로 아이템 추가/제거, 목록 확인, 알림 채널 설정, 체크 간격 설정 지원
- 아이템 목록을 `data/items.json`에 저장
- 알림 채널을 Discord 명령으로 설정하고 `data/settings.json`에 저장
- 같은 특가가 반복 알림되지 않도록 쿨다운 적용

## 요구 사항

- Node.js 22.12.0 이상
- Discord Bot Token
- Nexon Open API Key

discord.js 14.26.4 문서 기준으로 Node.js 22.12.0 이상과 ES modules 사용을 전제로 합니다.

## 설치

```bash
npm install
```

## 환경 설정

`.env.example`을 복사해 `.env`를 만들고 값을 채워 주세요.

```bash
cp .env.example .env
```

봇 실행 필수 값:

- `TOKEN`: Discord 봇 토큰

가격 조회 필수 값:

- `API_KEY`: Nexon Open API 키

선택 값:

- `MABINOGI_API_KEY`: `API_KEY` 대신 사용할 수 있는 Nexon Open API 키 변수명
- `DISCORD_CLIENT_ID`: `npm run deploy:commands`를 직접 사용할 때 필요한 Discord 애플리케이션 ID
- `DISCORD_GUILD_ID`: 개발 중 특정 서버에만 명령을 등록할 때 사용
- `DISCORD_BOT_TOKEN`: `TOKEN` 대신 사용할 수 있는 Discord 봇 토큰 변수명
- `DISCORD_CHANNEL_ID`: 시작 시 미리 지정할 알림 채널 ID. 비워 두고 `/알림채널 설정`으로 지정해도 됩니다.
- `MABINOGI_ITEMS`: `data/items.json`이 없을 때 최초로 가져올 아이템 목록
- `CHECK_INTERVAL_SECONDS`: 가격 체크 간격, 기본값 `10`
- `REQUEST_TIMEOUT_SECONDS`: Nexon API 요청 타임아웃, 기본값 `10`
- `ALERT_DISCOUNT_THRESHOLD`: 특가 판단 기준, 기본값 `0.1`
- `ALERT_COOLDOWN_SECONDS`: 같은 아이템 반복 알림 쿨다운, 기본값 `3600`
- `AUTO_DEPLOY_COMMANDS`: 봇 시작 시 명령 자동 등록 여부, 기본값 `true`

## 슬래시 명령 등록

기본값으로 봇 시작 시 슬래시 명령을 자동 등록합니다. `DISCORD_GUILD_ID`를 넣으면 해당 서버에 바로 반영되고, 비워 두면 전역 명령으로 등록되어 반영에 시간이 걸릴 수 있습니다.

직접 등록하고 싶다면 `DISCORD_CLIENT_ID`를 채운 뒤 아래 명령을 실행하세요.

```bash
npm run deploy:commands
```

`DISCORD_GUILD_ID`가 비어 있으면 전역 명령으로 등록됩니다. 전역 명령은 Discord에 반영되는 데 시간이 걸릴 수 있습니다.

## 실행

```bash
npm start
```

## 명령

- `/추가 아이템:<이름>`: 모니터링 아이템 추가
- `/제거 아이템:<이름>`: 모니터링 아이템 제거
- `/목록`: 현재 모니터링 목록 확인
- `/상태`: 봇 모니터링 루프 상태 확인
- `/구마`: 버튼 UI로 모니터링 아이템, 알림 채널, 체크 간격 관리
- `/알림채널 설정`: 현재 채널을 특가 알림 채널로 저장
- `/알림채널 보기`: 현재 특가 알림 채널 확인
- `/알림채널 해제`: 특가 알림 채널 설정 해제
- `/가격확인 아이템:<이름>`: 즉시 현재 최저가와 차순위 가격 확인

## Discord 봇 권한

슬래시 명령만 사용하므로 Message Content Intent는 필요하지 않습니다.

초대 URL 생성 시 권장 설정:

- Scopes: `bot`, `applications.commands`
- Bot Permissions: `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`

## systemd 예시

Linux 서버에서 장기 실행할 때 `systemd/mabinogi-kuma-bot.service`를 참고해 경로와 사용자를 환경에 맞게 수정하세요.

## 참고

- discord.js 14.26.4 문서: https://discord.js.org/docs/packages/discord.js/14.26.4
- Nexon Open API: https://openapi.nexon.com/
