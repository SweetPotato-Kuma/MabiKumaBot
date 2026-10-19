import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { runArbeitAlerts } from "../src/alerts.js";
import {
  CONSENT_VERSION,
  handleAutocomplete,
  handleCommand,
  handleComponent,
  parseInteraction,
} from "../src/commands.js";
import { erinClock, formatErinClock } from "../src/erin.js";
import worker from "../src/index.js";

const encoder = new TextEncoder();
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

async function signer() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = hex(await crypto.subtle.exportKey("raw", pair.publicKey));
  const sign = async (body, timestamp = "1700000000") => ({
    "x-signature-timestamp": timestamp,
    "x-signature-ed25519": hex(await crypto.subtle.sign("Ed25519", pair.privateKey, encoder.encode(timestamp + body))),
  });
  return { publicKey, sign };
}

async function call(env, body, headers) {
  return worker.fetch(new Request("https://bot.example/", { method: "POST", body, headers }), env);
}

const ENTRIES = [
  { id: "church", group: "성당", label: "성당(각 마을)", report: 16, verified: true },
  { id: "grocery", group: "식료품점", label: "식료품점(각 마을)", report: 14, verified: true },
  { id: "grocery-belvast", group: "식료품점", label: "식료품점 · 벨바스트", report: 12, verified: true },
  { id: "general-store", group: "잡화점", label: "잡화점(각 마을)", report: 9, verified: true },
];

/** 사이트 Worker 의 BotService 를 흉내 낸다. 계약은 사이트 저장소의 bot.test.js 가 확인한다. */
function fakeSite() {
  const users = new Map();
  const calls = [];
  const site = {
    calls,
    users,
    due: [],
    summary: null,
    items: [],
    fail: false,
    async getUser(id) {
      if (site.fail) throw new Error("down");
      return users.get(id) ?? null;
    },
    async registerUser(id, version) {
      calls.push(["registerUser", id, version]);
      users.set(id, {
        id,
        consentVersion: version,
        settings: { digest: true, paused: false, quiet: null, dmChannelId: null, disabledReason: null },
        arbeit: [],
      });
    },
    async deleteUser(id) {
      calls.push(["deleteUser", id]);
      users.delete(id);
    },
    async updateSettings(id, patch) {
      calls.push(["updateSettings", id, patch]);
      const user = users.get(id);
      user.settings = { ...user.settings, ...patch };
      return user.settings;
    },
    async markDmFailed(id) {
      calls.push(["markDmFailed", id]);
    },
    async changeArbeitSubs(id, change) {
      calls.push(["changeArbeitSubs", id, change]);
      const user = users.get(id);
      const all = ENTRIES.map((entry) => entry.id);
      const set = new Set(user.arbeit);
      if (change.all) all.forEach((entry) => set.add(entry));
      if (change.none) set.clear();
      (change.add ?? []).forEach((entry) => set.add(entry));
      (change.remove ?? []).forEach((entry) => set.delete(entry));
      user.arbeit = all.filter((entry) => set.has(entry));
      return user.arbeit;
    },
    async listArbeitEntries() {
      return ENTRIES;
    },
    async searchArbeitEntries(query) {
      return ENTRIES.filter((entry) => entry.label.includes(query) || entry.group.includes(query));
    },
    async dueArbeitAlerts(from, to) {
      calls.push(["dueArbeitAlerts", from, to]);
      return site.due;
    },
    async searchItems(query) {
      return site.items.filter((name) => name.startsWith(query));
    },
    async marketSummary(name) {
      calls.push(["marketSummary", name]);
      return site.summary;
    },
  };
  return site;
}

const ALICE = "111111111111111111";
const command = (path, values = {}, user = ALICE) => ({
  type: 2,
  member: { user: { id: user } },
  data: {
    name: path[0],
    options: nest(path.slice(1), Object.entries(values).map(([name, value]) => ({ name, value }))),
  },
});

function nest(path, leaf) {
  if (path.length === 0) return leaf;
  const type = path.length === 1 ? 1 : 2;
  return [{ type, name: path[0], options: nest(path.slice(1), leaf) }];
}

const button = (customId, user = ALICE) => ({ type: 3, member: { user: { id: user } }, data: { custom_id: customId } });
const content = (reply) => reply.data.content;
const isEphemeral = (reply) => reply.data.flags === 64;

describe("서명 확인", () => {
  it("서명이 맞는 PING 에 PONG 으로 답한다", async () => {
    const { publicKey, sign } = await signer();
    const body = JSON.stringify({ type: 1 });
    const response = await call({ DISCORD_PUBLIC_KEY: publicKey }, body, await sign(body));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { type: 1 });
  });

  it("본문이 바뀌었거나 서명이 없거나 다른 키로 서명하면 거절한다", async () => {
    const { publicKey, sign } = await signer();
    const other = await signer();
    const body = JSON.stringify({ type: 1 });
    const env = { DISCORD_PUBLIC_KEY: publicKey };

    assert.equal((await call(env, `${body} `, await sign(body))).status, 401);
    assert.equal((await call(env, body, {})).status, 401);
    assert.equal((await call(env, body, await other.sign(body))).status, 401);
    assert.equal((await call({ DISCORD_PUBLIC_KEY: "zz" }, body, await sign(body))).status, 401);
  });

  it("POST 가 아니면 거절한다", async () => {
    const response = await worker.fetch(new Request("https://bot.example/"), { DISCORD_PUBLIC_KEY: "00" });
    assert.equal(response.status, 405);
  });

  it("서명이 맞는 명령은 종류에 맞게 처리한다", async () => {
    const { publicKey, sign } = await signer();
    const site = fakeSite();
    site.items = ["마나 허브"];
    const env = { DISCORD_PUBLIC_KEY: publicKey, SITE: site };
    const send = async (interaction) => {
      const body = JSON.stringify(interaction);
      return (await call(env, body, await sign(body))).json();
    };

    assert.match(content(await send(command(["구마", "에린"]))), /에린 시각/);
    assert.equal((await send(button("consent:agree"))).type, 7);
    assert.equal(
      (await send({ ...command(["구마", "시세"], { 아이템: "마나" }), type: 4 })).type,
      8,
    );
  });
});

describe("에린", () => {
  it("/구마 에린 은 에린 시각과 상점 교체까지 남은 시간을 알려 준다", async () => {
    const reply = await handleCommand(command(["구마", "에린"]), {});
    assert.match(content(reply), /에린 시각 \*\*\d{2}:\d{2}\*\* \((낮|밤)\)/);
    assert.match(content(reply), /다음 상점 교체까지/);
  });

  it("직접 잰 게임 시계와 맞는다", async () => {
    const kst = (time) => Date.parse(`2026-10-19T${time}+09:00`);
    assert.equal(formatErinClock(erinClock(kst("09:54:21"))), "00:10");
    assert.equal(formatErinClock(erinClock(kst("09:54:51"))), "00:30");

    const reply = await handleCommand(command(["구마", "에린"]), {}, kst("09:54:21"));
    assert.match(content(reply), /00:10\*\* \(밤\)/);
  });

  it("모르는 명령은 본인에게만 보이게 안내한다", async () => {
    assert.equal(isEphemeral(await handleCommand(command(["구마", "없는명령"]), {})), true);
  });
});

describe("아르바이트 알림 명령", () => {
  let site;
  let env;

  beforeEach(() => {
    site = fakeSite();
    env = { SITE: site };
  });

  it("동의하기 전에는 동의 안내와 단추만 보여 준다", async () => {
    const reply = await handleCommand(command(["구마", "알바", "목록"]), env);

    assert.equal(isEphemeral(reply), true);
    assert.match(content(reply), /동의가 필요합니다/);
    assert.match(content(reply), /\/구마 내정보 삭제/);
    assert.equal(reply.data.components[0].components[0].custom_id, "consent:agree");
    assert.equal(site.users.size, 0);
  });

  it("동의 단추를 누르면 눌러 본인만 등록한다", async () => {
    const reply = await handleComponent(button("consent:agree"), env);

    assert.equal(reply.type, 7);
    assert.deepEqual(reply.data.components, []);
    assert.deepEqual(site.calls.at(-1), ["registerUser", ALICE, CONSENT_VERSION]);
  });

  describe("동의한 뒤", () => {
    beforeEach(async () => {
      await site.registerUser(ALICE, CONSENT_VERSION);
      site.calls.length = 0;
    });

    it("항목 번호나 이름으로 추가하고 삭제한다", async () => {
      assert.match(content(await handleCommand(command(["구마", "알바", "추가"], { 항목: "church" }), env)), /성당\(각 마을\).*켰습니다/);
      assert.match(content(await handleCommand(command(["구마", "알바", "추가"], { 항목: "잡화점" }), env)), /잡화점\(각 마을\).*켰습니다/);
      assert.deepEqual(site.users.get(ALICE).arbeit, ["church", "general-store"]);

      assert.match(content(await handleCommand(command(["구마", "알바", "삭제"], { 항목: "성당(각 마을)" }), env)), /껐습니다/);
      assert.deepEqual(site.users.get(ALICE).arbeit, ["general-store"]);
    });

    it("이름이 여러 항목에 맞거나 아무것도 맞지 않으면 아무것도 바꾸지 않는다", async () => {
      const many = await handleCommand(command(["구마", "알바", "추가"], { 항목: "식료품점" }), env);
      const none = await handleCommand(command(["구마", "알바", "추가"], { 항목: "없는곳" }), env);

      assert.match(content(many), /2개입니다/);
      assert.match(content(none), /맞는 항목이 없습니다/);
      assert.deepEqual(site.users.get(ALICE).arbeit, []);
    });

    it("전체 켜기와 끄기", async () => {
      assert.match(content(await handleCommand(command(["구마", "알바", "전체켜기"]), env)), /4개를 구독/);
      assert.equal(site.users.get(ALICE).arbeit.length, 4);
      assert.match(content(await handleCommand(command(["구마", "알바", "전체끄기"]), env)), /해제/);
      assert.deepEqual(site.users.get(ALICE).arbeit, []);
    });

    it("목록은 구독한 항목과 설정을 보여 준다", async () => {
      await site.changeArbeitSubs(ALICE, { add: ["church"] });
      const text = content(await handleCommand(command(["구마", "알바", "목록"]), env));

      assert.match(text, /\(1개\)/);
      assert.match(text, /• 성당\(각 마을\)/);
      assert.match(text, /한 메시지로 묶어 받기/);
    });

    it("설정을 바꾼다", async () => {
      await handleCommand(command(["구마", "알바", "설정"], { 묶어서받기: false, 일시정지: true }), env);
      assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { digest: false, paused: true }]);

      const quiet = await handleCommand(command(["구마", "알바", "설정"], { 조용한시작: 23, 조용한끝: 7 }), env);
      assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { quiet: { start: 23, end: 7 } }]);
      assert.match(content(quiet), /조용한 시간 23시~7시/);

      await handleCommand(command(["구마", "알바", "설정"], { 조용한시간끄기: true }), env);
      assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { quiet: null }]);
    });

    it("조용한 시간은 시작과 끝을 함께 받고 같은 값은 받지 않는다", async () => {
      const before = site.calls.length;
      assert.match(content(await handleCommand(command(["구마", "알바", "설정"], { 조용한시작: 5 }), env)), /함께/);
      assert.match(content(await handleCommand(command(["구마", "알바", "설정"], { 조용한시작: 5, 조용한끝: 5 }), env)), /같으면/);
      assert.equal(site.calls.length, before);
    });

    it("값을 주지 않으면 현재 설정만 보여 준다", async () => {
      const text = content(await handleCommand(command(["구마", "알바", "설정"]), env));
      assert.match(text, /현재 설정/);
      assert.equal(site.calls.filter((call) => call[0] === "updateSettings").length, 0);
    });

    it("DM 오류로 멈춘 사용자에게는 푸는 방법을 알려 준다", async () => {
      site.users.get(ALICE).settings.paused = true;
      site.users.get(ALICE).settings.disabledReason = "dm-failed";
      assert.match(content(await handleCommand(command(["구마", "알바", "목록"]), env)), /DM을 보낼 수 없어 멈춤/);
    });
  });

  it("사이트 Worker 가 실패하면 안내 문구로 답한다", async () => {
    site.fail = true;
    const reply = await handleCommand(command(["구마", "알바", "목록"]), env);
    assert.match(content(reply), /처리하지 못했습니다/);
    assert.equal(isEphemeral(reply), true);
  });
});

describe("내 정보 삭제", () => {
  it("등록하지 않았으면 지울 것이 없다고 알려 준다", async () => {
    const site = fakeSite();
    assert.match(content(await handleCommand(command(["구마", "내정보", "삭제"]), { SITE: site })), /저장된 정보가 없습니다/);
  });

  it("확인 단추를 눌러야 지운다", async () => {
    const site = fakeSite();
    const env = { SITE: site };
    await site.registerUser(ALICE, CONSENT_VERSION);

    const ask = await handleCommand(command(["구마", "내정보", "삭제"]), env);
    assert.deepEqual(ask.data.components[0].components.map((b) => b.custom_id), ["me:delete", "me:cancel"]);
    assert.equal(site.users.has(ALICE), true);

    assert.match(content(await handleComponent(button("me:cancel"), env)), /취소/);
    assert.equal(site.users.has(ALICE), true);

    assert.match(content(await handleComponent(button("me:delete"), env)), /삭제했습니다/);
    assert.equal(site.users.has(ALICE), false);
  });

  it("모르는 단추는 다시 실행하라고 안내한다", async () => {
    assert.match(content(await handleComponent(button("old:thing"), { SITE: fakeSite() })), /만료/);
  });
});

describe("시세", () => {
  it("24시간 통계와 7일 요약을 보여 준다", async () => {
    const site = fakeSite();
    site.summary = {
      name: "마나 허브",
      day: { n: 1234, qty: 5678, lo: 100, hi: 900, mid: 250, avg: 300 },
      series: [
        { date: "2026-10-18", mid: 240 },
        { date: "2026-10-19", mid: 250 },
      ],
    };
    const reply = await handleCommand(command(["구마", "시세"], { 아이템: "마나 허브" }), { SITE: site });

    assert.equal(isEphemeral(reply), false);
    assert.match(content(reply), /\*\*마나 허브\*\*/);
    assert.match(content(reply), /거래 1,234건 · 수량 5,678/);
    assert.match(content(reply), /중위가 \*\*250\*\*/);
    assert.match(content(reply), /10-18 240 · 10-19 250/);
  });

  it("거래 기록이 없으면 본인에게만 안내한다", async () => {
    const reply = await handleCommand(command(["구마", "시세"], { 아이템: "없음" }), { SITE: fakeSite() });
    assert.match(content(reply), /거래 기록이 없습니다/);
    assert.equal(isEphemeral(reply), true);
  });
});

describe("자동완성", () => {
  const focus = (path, value) => {
    const interaction = command(path, { 이름: value });
    let node = interaction.data;
    while (node.options?.[0]?.options) node = node.options[0];
    node.options[0].focused = true;
    return { ...interaction, type: 4 };
  };

  it("아이템 이름과 아르바이트 항목을 골라 준다", async () => {
    const site = fakeSite();
    site.items = ["마나 허브", "마나 허브 가루", "마늘"];
    const env = { SITE: site };

    const items = await handleAutocomplete(focus(["구마", "시세"], "마나"), env);
    assert.equal(items.type, 8);
    assert.deepEqual(items.data.choices.map((c) => c.value), ["마나 허브", "마나 허브 가루"]);

    const arbeit = await handleAutocomplete(focus(["구마", "알바", "추가"], "성당"), env);
    assert.deepEqual(arbeit.data.choices, [{ name: "성당(각 마을)", value: "church" }]);
  });

  it("삭제는 구독한 항목만 보여 준다", async () => {
    const site = fakeSite();
    await site.registerUser(ALICE, CONSENT_VERSION);
    await site.changeArbeitSubs(ALICE, { add: ["church"] });

    const reply = await handleAutocomplete(focus(["구마", "알바", "삭제"], ""), { SITE: site });
    assert.deepEqual(reply.data.choices.map((c) => c.value), ["church"]);
  });

  it("실패하면 빈 목록을 돌려준다", async () => {
    const site = fakeSite();
    site.searchItems = async () => {
      throw new Error("down");
    };
    const reply = await handleAutocomplete(focus(["구마", "시세"], "마"), { SITE: site });
    assert.deepEqual(reply.data.choices, []);
  });

  it("중첩된 입력에서 경로와 값을 읽는다", () => {
    const parsed = parseInteraction(command(["구마", "알바", "설정"], { 조용한시작: 23 }));
    assert.deepEqual(parsed.path, ["구마", "알바", "설정"]);
    assert.deepEqual(parsed.values, { 조용한시작: 23 });
  });
});

describe("알림 보내기", () => {
  const realFetch = globalThis.fetch;
  let site;
  let env;
  let requests;
  let script;

  const respond = (status, body = {}) => new Response(JSON.stringify(body), { status });

  beforeEach(() => {
    site = fakeSite();
    env = { SITE: site, DISCORD_BOT_TOKEN: "test-token" };
    requests = [];
    script = () => respond(200, { id: "900000000000000001" });
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.authorization });
      return script(String(url));
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const alert = (overrides = {}) => ({
    discordUserId: ALICE,
    digest: true,
    dmChannelId: null,
    entries: [
      { id: "church", label: "성당(각 마을)", group: "성당", at: 1 },
      { id: "grocery", label: "식료품점(각 마을)", group: "식료품점", at: 1 },
    ],
    ...overrides,
  });

  it("대상이 없으면 아무것도 보내지 않는다", async () => {
    const summary = await runArbeitAlerts(env, 1_700_000_060_000);

    assert.deepEqual(site.calls[0], ["dueArbeitAlerts", 1_700_000_000_000, 1_700_000_060_000]);
    assert.deepEqual(summary, { users: 0, sent: 0, failed: 0, stopped: 0 });
    assert.equal(requests.length, 0);
  });

  it("DM 채널이 없으면 만들어 기억시키고 묶어서 한 번 보낸다", async () => {
    site.due = [alert()];
    await site.registerUser(ALICE, CONSENT_VERSION);

    const summary = await runArbeitAlerts(env, 1_700_000_060_000);

    assert.equal(summary.sent, 1);
    assert.equal(requests[0].url.endsWith("/users/@me/channels"), true);
    assert.deepEqual(requests[0].body, { recipient_id: ALICE });
    assert.equal(requests[0].auth, "Bot test-token");
    assert.equal(requests[1].url.endsWith("/channels/900000000000000001/messages"), true);
    assert.match(requests[1].body.content, /• 성당\(각 마을\)\n• 식료품점\(각 마을\)/);
    assert.deepEqual(site.calls.find((c) => c[0] === "updateSettings"), [
      "updateSettings",
      ALICE,
      { dmChannelId: "900000000000000001" },
    ]);
  });

  it("기억해 둔 DM 채널이 있으면 채널을 만들지 않는다", async () => {
    site.due = [alert({ dmChannelId: "800000000000000002" })];
    await runArbeitAlerts(env, 1_700_000_060_000);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.endsWith("/channels/800000000000000002/messages"), true);
  });

  it("묶어 받지 않는 사람은 항목마다 따로 받는다", async () => {
    site.due = [alert({ digest: false, dmChannelId: "800000000000000002" })];
    const summary = await runArbeitAlerts(env, 1_700_000_060_000);

    assert.equal(summary.sent, 2);
    assert.deepEqual(requests.map((r) => r.body.content), [
      "**성당(각 마을)** 아르바이트를 보고할 수 있습니다.",
      "**식료품점(각 마을)** 아르바이트를 보고할 수 있습니다.",
    ]);
  });

  it("기억해 둔 채널이 사라졌으면 새로 만들어 다시 보낸다", async () => {
    site.due = [alert({ dmChannelId: "800000000000000002" })];
    await site.registerUser(ALICE, CONSENT_VERSION);
    let first = true;
    script = (url) => {
      if (url.endsWith("/channels/800000000000000002/messages") && first) {
        first = false;
        return respond(404, { code: 10003 });
      }
      return respond(200, { id: "900000000000000001" });
    };

    const summary = await runArbeitAlerts(env, 1_700_000_060_000);

    assert.equal(summary.sent, 1);
    assert.deepEqual(requests.map((r) => r.url.split("/v10")[1]), [
      "/channels/800000000000000002/messages",
      "/users/@me/channels",
      "/channels/900000000000000001/messages",
    ]);
  });

  it("DM 이 막힌 사람은 멈추고 다른 사람에게는 계속 보낸다", async () => {
    const BOB = "222222222222222222";
    site.due = [alert({ dmChannelId: "800000000000000002" }), alert({ discordUserId: BOB, dmChannelId: "800000000000000003" })];
    script = (url) =>
      url.includes("800000000000000002") ? respond(403, { code: 50007 }) : respond(200, { id: "1" });

    const summary = await runArbeitAlerts(env, 1_700_000_060_000);

    assert.deepEqual(summary, { users: 2, sent: 1, failed: 0, stopped: 1 });
    assert.deepEqual(site.calls.find((c) => c[0] === "markDmFailed"), ["markDmFailed", ALICE]);
  });

  it("그 밖의 오류는 멈추지 않고 실패로만 센다", async () => {
    site.due = [alert({ dmChannelId: "800000000000000002" })];
    script = () => respond(500, {});

    const summary = await runArbeitAlerts(env, 1_700_000_060_000);

    assert.deepEqual(summary, { users: 1, sent: 0, failed: 1, stopped: 0 });
    assert.equal(site.calls.some((c) => c[0] === "markDmFailed"), false);
  });

  it("너무 많이 보내 429 가 오면 기다렸다 한 번 다시 보낸다", async () => {
    site.due = [alert({ dmChannelId: "800000000000000002" })];
    let limited = true;
    script = () => {
      if (limited) {
        limited = false;
        return respond(429, { retry_after: 0 });
      }
      return respond(200, { id: "1" });
    };

    const summary = await runArbeitAlerts(env, 1_700_000_060_000);

    assert.equal(summary.sent, 1);
    assert.equal(requests.length, 2);
  });

  it("예약 시각이 오면 지난 1분 구간으로 알린다", async () => {
    const waited = [];
    await worker.scheduled({ scheduledTime: 1_700_000_120_000 }, env, { waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);

    assert.deepEqual(site.calls[0], ["dueArbeitAlerts", 1_700_000_060_000, 1_700_000_120_000]);
  });
});
