import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { runArbeitAlerts, runSearchAlerts } from "../src/alerts.js";
import { CONSENT_VERSION } from "../src/commands.js";
import { chunkMessages, searchAlertMessages } from "../src/format.js";
import worker from "../src/index.js";
import { ALICE, BOB, fakeSite } from "./helpers.js";

const respond = (status, body = {}) => new Response(JSON.stringify(body), { status });

describe("메시지 나누기", () => {
  it("길면 줄을 쪼개지 않고 여러 통으로 나눈다", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `• 아이템 ${i} ${"가".repeat(40)}`);
    const messages = chunkMessages("**머리**", lines, "-# 꼬리");

    assert.ok(messages.length > 1);
    for (const message of messages) {
      assert.ok(message.length <= 2000);
      assert.ok(message.startsWith("**머리**\n"));
      assert.ok(message.endsWith("\n-# 꼬리"));
    }
    assert.equal(messages.join("\n").split("• 아이템 ").length - 1, 60);
  });
});

describe("알림 보내기", () => {
  const realFetch = globalThis.fetch;
  let site;
  let env;
  let requests;
  let script;

  beforeEach(async () => {
    site = fakeSite();
    env = { SITE: site, DISCORD_BOT_TOKEN: "test-token" };
    requests = [];
    script = () => respond(200, { id: "900000000000000001" });
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.authorization });
      return script(String(url));
    };
    await site.registerUser(ALICE, CONSENT_VERSION);
    site.calls.length = 0;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  describe("아르바이트", () => {
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
      const summary = await runArbeitAlerts(env, 1_700_000_060_000);

      assert.equal(summary.sent, 1);
      assert.equal(requests[0].url.endsWith("/users/@me/channels"), true);
      assert.deepEqual(requests[0].body, { recipient_id: ALICE });
      assert.equal(requests[0].auth, "Bot test-token");
      assert.equal(requests[1].url.endsWith("/channels/900000000000000001/messages"), true);
      assert.match(requests[1].body.content, /• 성당\(각 마을\)\n• 식료품점\(각 마을\)/);
      assert.match(requests[1].body.content, /\/마비쿠마 의 알림 설정/);
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
      site.due = [
        alert({ dmChannelId: "800000000000000002" }),
        alert({ discordUserId: BOB, dmChannelId: "800000000000000003" }),
      ];
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
  });

  describe("저장 검색의 목표 가격", () => {
    const found = (name, price) => ({
      id: 1,
      name,
      price,
      target: price + 10,
      total: 3,
      items: [
        { name: "롱 소드", price, count: 1, notes: ["세공 스매시 대미지 5레벨"] },
        { name: "롱 소드", price: price + 500, count: 2, notes: [] },
      ],
      conditions: ["세공 스매시 대미지 5레벨 이상"],
      url: `https://mabi.spkuma.com/auction?category=%EA%B2%80&ref=bot`,
      checkedAt: 1_700_000_000_000,
    });
    const alert = (overrides = {}) => ({
      discordUserId: ALICE,
      digest: true,
      dmChannelId: "800000000000000002",
      searches: [found("스매시 검", 50000), found("천옷", 9000)],
      ...overrides,
    });

    it("분 번호를 넘겨 확인하고 대상이 없으면 보내지 않는다", async () => {
      const summary = await runSearchAlerts(env, 1_700_000_040_000);

      assert.deepEqual(site.calls[0], ["dueSearchAlerts", Math.floor(1_700_000_040_000 / 60_000)]);
      assert.deepEqual(summary, { users: 0, sent: 0, failed: 0, stopped: 0 });
      assert.equal(requests.length, 0);
    });

    it("묶어서 한 통에 검색마다 카드를 한 장씩 보낸다", async () => {
      site.searchDue = [alert()];
      const summary = await runSearchAlerts(env, 1_700_000_040_000);

      assert.equal(summary.sent, 1);
      const [first, second] = requests[0].body.embeds;
      assert.equal(first.title, "목표 가격 도달: 스매시 검");
      assert.equal(first.url, "https://mabi.spkuma.com/auction?category=%EA%B2%80&ref=bot");
      assert.match(first.description, /^최저 \*\*50,000\*\* \(목표 50,010\), 조건에 맞는 매물 3개\n\*\*1\.\*\* 50,000 롱 소드\n　세공 스매시 대미지 5레벨\n\*\*2\.\*\* 50,500 롱 소드 ×2$/);
      assert.equal(first.timestamp, new Date(1_700_000_000_000).toISOString());
      assert.match(first.footer.text, /알림 설정/);
      assert.equal(second.title, "목표 가격 도달: 천옷");
    });

    it("묶어 받지 않는 사람은 검색마다 따로 받는다", async () => {
      site.searchDue = [alert({ digest: false })];
      const summary = await runSearchAlerts(env, 1_700_000_040_000);

      assert.equal(summary.sent, 2);
      assert.equal(requests[0].body.embeds.length, 1);
      assert.equal(requests[1].body.embeds[0].title, "목표 가격 도달: 천옷");
    });

    it("카드가 10장을 넘으면 나눠 보낸다", () => {
      const many = alert({ searches: Array.from({ length: 12 }, (_, i) => found(`검색${i}`, 100 + i)) });
      assert.deepEqual(searchAlertMessages(many).map((each) => each.embeds.length), [10, 2]);
    });

    it("DM 이 막힌 사람은 멈춘다", async () => {
      site.searchDue = [alert()];
      script = () => respond(403, { code: 50007 });

      const summary = await runSearchAlerts(env, 1_700_000_040_000);

      assert.deepEqual(summary, { users: 1, sent: 0, failed: 0, stopped: 1 });
      assert.deepEqual(site.calls.find((c) => c[0] === "markDmFailed"), ["markDmFailed", ALICE]);
    });
  });

  it("예약 시각이 오면 아르바이트와 저장 검색을 모두 확인한다", async () => {
    const waited = [];
    await worker.scheduled({ scheduledTime: 1_700_000_120_000 }, env, { waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);

    assert.deepEqual(site.calls.find((c) => c[0] === "dueArbeitAlerts"), [
      "dueArbeitAlerts",
      1_700_000_060_000,
      1_700_000_120_000,
    ]);
    assert.deepEqual(site.calls.find((c) => c[0] === "dueSearchAlerts"), [
      "dueSearchAlerts",
      Math.floor(1_700_000_120_000 / 60_000),
    ]);
  });
});
