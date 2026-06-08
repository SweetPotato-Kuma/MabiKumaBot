# Mabinogi Guma Bot

`mabinogi-guma-bot`은 Nexon Open API의 마비노기 경매장 데이터를 조회해 Discord에서 가격 알림을 보내는 JavaScript Discord 봇입니다.

discord.js v14 방식의 슬래시 명령어를 사용합니다. 경매장 기능은 `/구마`, 로또 추첨 기능은 `/추첨` 명령어로 사용합니다.

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
- `/추첨` 명령어로 로또 번호 조합 5개 생성

## 요구 사항

- Node.js 22.12.0 이상
- Discord Bot Token
- Nexon Open API Key

## 설치 가이드

처음 설치할 때는 아래 순서대로 진행하면 됩니다.

### 1. 프로젝트 받기

Git으로 받은 경우:

```bash
git clone https://github.com/SweetPotato-Kuma/MabiKumaBot.git
cd MabiKumaBot
```

ZIP 파일로 받은 경우:

- 압축을 풉니다.
- 압축을 푼 폴더 안에서 터미널을 엽니다.
- 터미널 위치가 `package.json` 파일이 있는 폴더인지 확인합니다.

### 2. Node.js 설치 확인

터미널에서 아래 명령을 실행합니다.

```bash
node -v
npm -v
```

`node -v` 결과가 `v22.12.0` 이상이면 됩니다. Node.js가 없거나 버전이 낮으면 [Node.js](https://nodejs.org/)를 설치한 뒤 터미널을 다시 열어 주세요.

### 3. 패키지 설치

프로젝트 폴더에서 아래 명령을 실행합니다.

```bash
npm install
```

설치가 끝나면 `node_modules` 폴더가 생깁니다.

### 4. Discord 봇 토큰 준비

1. [Discord Developer Portal](https://discord.com/developers/applications)에 접속합니다.
2. 애플리케이션을 만들고 Bot 메뉴에서 봇을 생성합니다.
3. 봇 토큰을 복사합니다.
4. 봇을 서버에 초대할 때 아래 권한을 선택합니다.

- Scopes: `bot`, `applications.commands`
- Bot Permissions: `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`

슬래시 명령어 기반이라 Message Content Intent는 필요하지 않습니다.

### 5. Nexon Open API 키 준비

1. [Nexon Open API](https://openapi.nexon.com/)에 접속합니다.
2. 애플리케이션을 만들고 API 키를 발급받습니다.
3. 발급받은 키를 복사합니다.

### 6. `.env` 파일 만들기

프로젝트 루트에서 `.env.example` 파일을 복사해 `.env` 파일을 만듭니다.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

`.env` 파일을 열고 아래 두 값만 채웁니다.

```env
TOKEN=여기에_Discord_봇_토큰
API_KEY=여기에_Nexon_Open_API_키
```

`.env` 파일은 토큰이 들어가는 개인 설정 파일입니다. Git에 올리지 마세요.

### 7. 봇 실행

Windows에서는 아래 파일을 더블클릭하면 됩니다.

- `start-bot.bat`: 봇 시작
- `stop-bot.bat`: 봇 종료

터미널에서 직접 실행하려면 아래 명령을 사용합니다.

```bash
npm start
```

봇이 정상 실행되면 현재 봇이 들어가 있는 Discord 서버에 `/구마`, `/추첨` 명령어가 자동 등록됩니다.

실행 로그는 `bot.log`, 오류 로그는 `bot.err`에 기록됩니다. 이미 실행 중이면 `start-bot.bat`은 중복 실행하지 않습니다.

### 8. Discord에서 첫 설정

1. Discord 서버에서 `/구마`를 입력합니다.
2. `설정/상태`를 눌러 현재 채널을 알림 채널로 지정합니다.
3. `아이템 추가`를 눌러 감시할 아이템을 추가합니다.
4. `가격 검색`으로 현재 경매장 가격을 바로 확인할 수 있습니다.
5. `/추첨`을 입력하면 로또 번호 추첨 버튼을 사용할 수 있습니다.

## 실행 파일

### Windows 한글 출력

README, 로그, PowerShell 출력의 한글이 깨져 보이면 콘솔 코드페이지가 UTF-8이 아닌 상태입니다. `start-bot.bat`, `stop-bot.bat`은 실행 시 자동으로 UTF-8 코드페이지(`65001`)를 사용합니다.

수동으로 파일을 확인할 때는 아래처럼 UTF-8로 읽어 주세요.

```powershell
chcp 65001
Get-Content -Encoding UTF8 README.md
Get-Content -Encoding UTF8 bot.log -Tail 50
```

## 명령어

경매장 관리는 `/구마` 버튼 UI를 사용합니다.

- 아이템 추가
- 목록/삭제: `아이템명 + 삭제` 행에서 원하는 항목을 바로 삭제
- 가격 검색: 아이템명을 입력해 가격 확인
- 설정/상태: 현재 채널을 서버 알림 채널로 설정, 알림 기준, 체크 간격, 상태 확인

로또 번호 추첨은 `/추첨` 명령어를 사용합니다.

아이템명을 입력하면 경매장 후보가 있는 경우 선택 메뉴로 실제 아이템명과 자동 분류를 확인할 수 있습니다. 아이템 추가 시에는 Nexon 경매장 매물 존재 여부를 검증한 뒤 확인된 분류를 저장하고, 가격 체크는 `/mabinogi/v1/auction/list`에 `auction_item_category`와 `item_name`을 함께 넣어 같은 카테고리의 매물만 비교합니다.

목록, 알림 채널, 알림 기준은 Discord 서버별 공용 설정입니다. 같은 서버 안에서는 누가 `/구마`를 사용해도 같은 아이템 목록과 같은 알림 설정을 보고, 알림도 서버당 한 번만 전송됩니다.

기존 사용자별 `data/items.json`, `data/settings.json` 데이터가 남아 있는 경우, 봇 시작 시 서버 공용 저장소로 자동 병합됩니다.

## 참고

- [discord.js 14.26.4 문서](https://discord.js.org/docs/packages/discord.js/14.26.4)
- [Nexon Open API](https://openapi.nexon.com/)
