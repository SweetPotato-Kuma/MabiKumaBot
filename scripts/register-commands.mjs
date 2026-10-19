// 슬래시 명령을 디스코드에 등록한다. 봇 토큰은 환경 변수 또는 .dev.vars 에서 읽고 출력하지 않는다.
//   node scripts/register-commands.mjs --guild <서버 ID>   해당 서버에만 등록(테스트용)
//   node scripts/register-commands.mjs --global           모든 서버에 등록(기존 전역 명령을 덮어쓴다)
import { readFile } from "node:fs/promises";

import { COMMANDS } from "../worker/src/commands.js";

async function readDevVars() {
  try {
    const text = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
        .filter(Boolean)
        .map((match) => [match[1], match[2]]),
    );
  } catch {
    return {};
  }
}

const args = process.argv.slice(2);
const guildIndex = args.indexOf("--guild");
const guildId = guildIndex >= 0 ? args[guildIndex + 1] : null;
const isGlobal = args.includes("--global");

if (!isGlobal && !guildId) {
  console.error("--guild <서버 ID> 또는 --global 중 하나를 지정해 주세요.");
  process.exit(1);
}

const vars = { ...(await readDevVars()), ...process.env };
const applicationId = vars.DISCORD_APPLICATION_ID;
const token = vars.DISCORD_BOT_TOKEN;
if (!applicationId || !token) {
  console.error("DISCORD_APPLICATION_ID 와 DISCORD_BOT_TOKEN 이 필요합니다(.dev.vars 또는 환경 변수).");
  process.exit(1);
}

const path = isGlobal
  ? `/applications/${applicationId}/commands`
  : `/applications/${applicationId}/guilds/${guildId}/commands`;
const response = await fetch(`https://discord.com/api/v10${path}`, {
  method: "PUT",
  headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
  body: JSON.stringify(COMMANDS),
});

if (!response.ok) {
  console.error(`등록 실패: HTTP ${response.status}`);
  console.error((await response.text()).slice(0, 500));
  process.exit(1);
}
const registered = await response.json();
console.log(`명령 ${registered.length}개를 ${isGlobal ? "전역" : `서버 ${guildId}`}에 등록했습니다.`);
