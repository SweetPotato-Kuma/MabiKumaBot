# Mabinogi Guma Bot

`mabinogi-guma-bot`은 Nexon Open API의 마비노기 경매장 데이터를 조회해 Discord에서 가격 알림을 보내는 JavaScript Discord 봇입니다.

discord.js v14 방식의 슬래시 명령어를 사용하며, 모든 기능은 `/구마` 명령어 안의 버튼 UI로 관리합니다.

## 기능

- Nexon Open API 마비노기 경매장 키워드 검색 사용
- `마나허브`처럼 공백 없이 입력해도 `마나 허브` 같은 실제 경매장 아이템명으로 검색
- 아이템명 입력 후 Nexon 경매장 후보를 선택하는 보조 UI 지원
- 아이템 추가 시 Nexon 경매장 매물 존재 여부 검증
- 확정된 아이템의 자동 분류와 관련 검색어를 저장해 `파멸의 로브`와 `옷본 - 파멸의 로브`처럼 같은 아이템군의 매물을 함께 확인
- 서버별 공용 모니터링 아이템 목록 저장
- 서버별 공용 알림 채널 저장
- 서버별 공용 알림 기준 저장: 기준가(차순위 가격)보다 `10~100%` 이상 낮을 때 알림
- 체크 간격 커스텀, 기본값 `10초`
- 목록/삭제 버튼에서 `아이템명 + 삭제` 행으로 바로 삭제
- 이 채널로 알림, 알림 기준, 체크 간격, 상태 확인을 설정/상태 모달 하나로 관리
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
- `DISCORD_GUILD_ID`: `npm run deploy:commands`로 특정 서버에만 수동 등록하고 싶을 때 사용할 Discord 서버 ID. 봇 실행 중에는 현재 봇이 속한 서버를 자동 감지해 서버별로 명령어를 등록합니다.
- `DISCORD_BOT_TOKEN`: `TOKEN` 대신 사용할 Discord 봇 토큰 변수명
- `MABINOGI_API_KEY`: `API_KEY` 대신 사용할 Nexon Open API 키 변수명
- `MABINOGI_AUCTION_LIST_ENDPOINT`: 경매장 카테고리/아이템명 가격 조회 API. 기본값은 Nexon `/mabinogi/v1/auction/list`
- `DISCORD_CHANNEL_ID`: 시작 시 사용할 기본 알림 채널 ID. 이후 `/구마`에서 서버별 알림 채널로 덮어쓸 수 있습니다.
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

`AUTO_DEPLOY_COMMANDS=true`이면 봇 시작 시 현재 속한 Discord 서버를 자동으로 읽어 각 서버에 `/구마` 명령어를 등록합니다. 봇이 새 서버에 초대되는 경우에도 해당 서버에 명령어를 자동 등록합니다.

### Windows 한글 출력

README, 로그, PowerShell 출력의 한글이 깨져 보이면 콘솔 코드페이지가 UTF-8이 아닌 상태입니다. `start-bot.bat`, `stop-bot.bat`은 실행 시 자동으로 UTF-8 코드페이지(`65001`)를 사용합니다.

수동으로 파일을 확인할 때는 아래처럼 UTF-8로 읽어 주세요.

```powershell
chcp 65001
Get-Content -Encoding UTF8 README.md
Get-Content -Encoding UTF8 bot.log -Tail 50
```

## 명령어

기본 관리는 `/구마` 버튼 UI를 사용합니다.

- 아이템 추가
- 목록/삭제: `아이템명 + 삭제` 행에서 원하는 항목을 바로 삭제
- 가격 검색: 아이템명을 입력해 가격 확인
- 설정/상태: 현재 채널을 서버 알림 채널로 설정, 알림 기준, 체크 간격, 상태 확인

아이템명을 입력하면 경매장 후보가 있는 경우 선택 메뉴로 실제 아이템명과 자동 분류를 확인할 수 있습니다. 아이템 추가 시에는 Nexon 경매장 매물 존재 여부를 검증한 뒤 확인된 분류를 저장하고, 가격 체크는 `/mabinogi/v1/auction/list`에 `auction_item_category`와 `item_name`을 함께 넣어 같은 카테고리의 매물만 비교합니다.

목록, 알림 채널, 알림 기준은 Discord 서버별 공용 설정입니다. 같은 서버 안에서는 누가 `/구마`를 사용해도 같은 아이템 목록과 같은 알림 설정을 보고, 알림도 서버당 한 번만 전송됩니다.

기존 사용자별 `data/items.json`, `data/settings.json` 데이터가 남아 있는 경우, 봇 시작 시 서버 공용 저장소로 자동 병합됩니다.

## Discord 봇 권한

슬래시 명령어 기반이라 Message Content Intent는 필요하지 않습니다.

초대 URL 생성 시 권장 설정:

- Scopes: `bot`, `applications.commands`
- Bot Permissions: `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`

## systemd 예시

Linux 서버에서 장기 실행하려면 `systemd/mabinogi-guma-bot.service`를 참고해 경로와 사용자 환경에 맞게 수정하세요.

## 참고

- [discord.js 14.26.4 문서](https://discord.js.org/docs/packages/discord.js/14.26.4)
- [Nexon Open API](https://openapi.nexon.com/)
