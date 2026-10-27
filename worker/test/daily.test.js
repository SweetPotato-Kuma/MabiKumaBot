import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { CONSENT_VERSION } from "../src/commands.js";
import { bonusView, dailyView, hourLabel, nextKstHour, reminderView, runDailyAlerts } from "../src/daily.js";
import { resetEmojisForTest } from "../src/emojis.js";
import { ALICE, click, fakeSite, find, ids, run } from "./helpers.js";

const GUILD = "333333333333333333";
const CHANNEL = "444444444444444444";
const card = {
  date: "10월 27일",
  day: "화",
  celtic: "벨테인",
  bonuses: ["던전에서 아이템이 나올 가능성이 높아진다", "전투계열 스킬의 랭크업 보너스가 증가한다"],
  box: {
    day: "화",
    fromHour: 7,
    items: [
      { key: "mk_blessing_potion", name: "대용량 축복의 포션", count: 1, icon: null },
      { key: "mk_lunchbox", name: "로나의 특제 도시락", count: 1, icon: null },
    ],
  },
  tomorrow: { day: "수", celtic: "알반 헤루인", short: "채집 확률, 상점 할인" },
  week: [
    { day: "일", celtic: "임볼릭", short: "크리티컬" },
    { day: "월", celtic: "알반 에일레르", short: "생산 성공률" },
  ],
};
const ADMIN = String(1 << 5);
const inGuild = (customId, values, permissions = ADMIN) => ({
  ...click(customId, values),
  guild_id: GUILD,
  member: { user: { id: ALICE }, permissions },
  authorizing_integration_owners: { 0: GUILD },
});

let site;
beforeEach(() => {
  resetEmojisForTest();
  site = fakeSite();
  site.dailyCard = async () => card;
  site.guilds = new Map();
  site.getGuild = async (id) => ({ id, settings: site.guilds.get(id) ?? { dailyChannelId: null, dailyHour: null } });
  site.updateGuildSettings = async (id, patch) => {
    const next = { ...(site.guilds.get(id) ?? { dailyChannelId: null, dailyHour: null }), ...patch };
    site.guilds.set(id, next);
    site.calls.push(["updateGuildSettings", id, patch]);
    return { id, settings: next };
  };
  site.stopGuildDaily = async (id) => site.updateGuildSettings(id, { dailyChannelId: null, dailyHour: null });
});

describe("매일 알림 카드", () => {
  it("요일 보너스, 오늘 상자(이모지 아이콘), 내일 한 줄을 보여 준다", () => {
    const emojis = new Map([["mk_lunchbox", "<:mk_lunchbox:1>"]]);
    const body = dailyView(card, emojis, { footer: "매일 오전 7시 알림" });
    const [embed] = body.embeds;
    assert.equal(embed.author.name, "10월 27일 화요일 · 벨테인");
    assert.match(embed.description, /\*\*요일 보너스\*\* \(자정부터\)\n• 던전에서/);
    assert.match(embed.description, /\*\*어드밴스드 상자\*\* \(오전 7시부터\)/);
    assert.match(embed.description, /\n대용량 축복의 포션 1개\n<:mk_lunchbox:1> 로나의 특제 도시락 1개/);
    assert.match(embed.description, /내일\(수\) 알반 헤루인: 채집 확률, 상점 할인$/);
    assert.deepEqual(ids(body), ["d:bonus"]);
    assert.deepEqual(ids(dailyView(card, emojis, { channel: true })), ["d:bonus", "d:set"]);
  });

  it("오전 7시 전에는 아직 어제 상자라고 적는다", () => {
    const early = dailyView({ ...card, box: { ...card.box, day: "월" } }, new Map());
    assert.match(early.embeds[0].description, /\(오전 7시까지 월요일 상자\)/);
  });

  it("요일 보너스 보기는 요일 보너스만 보여 준다", () => {
    const body = bonusView(card);
    assert.equal(body.embeds[0].author.name, "요일 보너스");
    assert.match(body.embeds[0].description, /\*\*일 임볼릭\*\* 크리티컬/);
    assert.doesNotMatch(body.embeds[0].description, /어드밴스드/);
  });

  it("시각을 한국어로 읽기 좋게 적는다", () => {
    assert.deepEqual([0, 7, 12, 21].map(hourLabel), ["자정", "오전 7시", "낮 12시", "오후 9시"]);
  });
});

describe("개인 매일 알림 설정", () => {
  beforeEach(() => site.registerUser(ALICE, CONSENT_VERSION));

  it("꺼져 있으면 오전 7시에 받기 단추로 켜고, 시각을 바꾸고, 끈다", async () => {
    const opened = await run(site, click("s:daily"));
    assert.match(opened.view.content, /매일 알림\*\* 꺼짐/);
    assert.equal(find(opened.view, "s:dailyon").label, "오전 7시에 받기");

    const on = await run(site, click("s:dailyon"));
    assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { daily: 7 }]);
    assert.match(on.view.content, /오전 7시에 DM · 자정 전 알림 오후 11시/);
    assert.equal(find(on.view, "s:dailyr").label, "자정 전 알림: 켜짐");

    const quiet = await run(site, click("s:dailyr"));
    assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { dailyRemind: false }]);
    assert.equal(find(quiet.view, "s:dailyr").label, "자정 전 알림: 꺼짐");
    assert.doesNotMatch(quiet.view.content, /자정 전 알림 오후/);
    await run(site, click("s:dailyr"));
    assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { dailyRemind: true }]);
    assert.equal(find(on.view, "s:dailyh").options.find((o) => o.default).value, "7");

    await run(site, click("s:dailyh", ["21"]));
    assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { daily: 21 }]);
    await run(site, click("s:dailyoff"));
    assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { daily: null }]);
  });

  it("미리 보기와 요일 보너스 보기는 누른 사람에게만 새 메시지로 보인다", async () => {
    const preview = await run(site, click("d:preview"));
    assert.equal(preview.initial.type, 4);
    assert.equal(preview.view.flags, 64);
    assert.equal(preview.view.embeds[0].author.name, "10월 27일 화요일 · 벨테인");
    assert.equal((await run(site, click("d:bonus"))).view.embeds[0].author.name, "요일 보너스");
  });
});

describe("서버 설정", () => {
  it("서버 관리자에게만 메뉴에 서버 설정이 보인다", async () => {
    assert.ok(ids((await run(site, inGuild("m:menu"))).view).includes("g:open"));
    assert.ok(!ids((await run(site, inGuild("m:menu", undefined, "0"))).view).includes("g:open"));
    assert.ok(!ids((await run(site, click("m:menu"))).view).includes("g:open"));
  });

  it("관리자가 아니면 바꿀 수 없다", async () => {
    const denied = await run(site, inGuild("g:ch", [CHANNEL], "0"));
    assert.match(denied.view.content, /서버 관리 권한이 있는 사람만/);
    assert.equal(site.guilds.size, 0);
  });

  it("채널을 고르면 오전 7시로 켜지고, 시각을 바꾸고, 끈다", async () => {
    const opened = await run(site, inGuild("g:open"));
    assert.match(opened.view.content, /매일 알림 꺼짐/);
    const chose = await run(site, inGuild("g:ch", [CHANNEL]));
    assert.deepEqual(site.guilds.get(GUILD), { dailyChannelId: CHANNEL, dailyHour: 7 });
    assert.match(chose.view.content, new RegExp(`<#${CHANNEL}> 에 오전 7시`));
    await run(site, inGuild("g:hr", ["9"]));
    assert.equal(site.guilds.get(GUILD).dailyHour, 9);
    const off = await run(site, inGuild("g:off"));
    assert.match(off.view.content, /매일 알림을 껐습니다/);
    assert.equal(site.guilds.get(GUILD).dailyChannelId, null);
  });

  it("지금 한 번 올려 보기는 채널에 카드를 올리고, 쓸 수 없으면 이유를 알려 준다", async () => {
    site.guilds.set(GUILD, { dailyChannelId: CHANNEL, dailyHour: 7 });
    const ok = await run(site, inGuild("g:test"));
    assert.match(ok.view.content, /채널에 올렸습니다/);
    const posted = ok.edits.find((each) => each.url.endsWith(`/channels/${CHANNEL}/messages`));
    assert.equal(posted.body.embeds[0].author.name, "10월 27일 화요일 · 벨테인");
    assert.deepEqual(posted.body.components[0].components.map((c) => c.custom_id), ["d:bonus", "d:set"]);
  });
});

describe("정한 시각에 보내기", () => {
  const realFetch = globalThis.fetch;
  let requests;
  let channelStatus;
  beforeEach(() => {
    requests = [];
    channelStatus = 200;
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
      if (String(url).endsWith("/emojis")) return new Response(JSON.stringify({ items: [] }));
      if (String(url).includes(`/channels/${CHANNEL}/`)) {
        return new Response(JSON.stringify(channelStatus === 200 ? { id: "800000000000000010" } : {}), { status: channelStatus });
      }
      return new Response(JSON.stringify({ id: "800000000000000009" }));
    };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const env = () => ({ SITE: site, DISCORD_BOT_TOKEN: "t", DISCORD_APPLICATION_ID: "app" });
  const at = (text) => Date.parse(`${text}+09:00`);

  it("정각에만 돌고, 그 시에 받을 사람에게 DM 을, 서버 채널에 카드를 올린다", async () => {
    site.dueDailyDigests = async (hour) => {
      site.calls.push(["dueDailyDigests", hour]);
      return { card, users: [{ discordUserId: ALICE, dmChannelId: "800000000000000002" }], guilds: [{ guildId: GUILD, channelId: CHANNEL }] };
    };
    assert.equal(await runDailyAlerts(env(), at("2026-10-27T07:01:00")), null);
    const summary = await runDailyAlerts(env(), at("2026-10-27T07:00:00"));
    assert.deepEqual(site.calls.find((c) => c[0] === "dueDailyDigests"), ["dueDailyDigests", 7]);
    assert.deepEqual(summary, { users: 1, guilds: 1, sent: 2, failed: 0, stopped: 0 });
    assert.ok(requests.some((r) => r.url.endsWith("/channels/800000000000000002/messages")));
    const post = requests.find((r) => r.url.endsWith(`/channels/${CHANNEL}/messages`));
    assert.equal(post.body.embeds[0].footer.text, "매일 오전 7시 알림");
    // 카드는 상자가 바뀌는 다음 날 오전 7시에 지운다(DM, 서버 채널 모두).
    const tomorrow7 = at("2026-10-28T07:00:00");
    assert.deepEqual(site.calls.find((c) => c[0] === "scheduleCleanup")[1], [
      { channelId: "800000000000000002", messageId: "800000000000000009", deleteAt: tomorrow7 },
      { channelId: CHANNEL, messageId: "800000000000000010", deleteAt: tomorrow7 },
    ]);
  });

  it("오후 11시에는 자정 전 알림을 DM 과 서버 채널에 보내고 자정에 지운다", async () => {
    site.dueDailyDigests = async () => ({ card: null, users: [], guilds: [] });
    site.dueDailyReminders = async () => ({
      card,
      users: [{ discordUserId: ALICE, dmChannelId: "800000000000000002" }],
      guilds: [{ guildId: GUILD, channelId: CHANNEL }],
    });
    const summary = await runDailyAlerts(env(), at("2026-10-27T23:00:00"));
    assert.deepEqual(summary.reminders, { users: 1, guilds: 1, sent: 2, failed: 0, stopped: 0 });
    const dm = requests.find((r) => r.url.endsWith("/channels/800000000000000002/messages"));
    assert.equal(dm.body.embeds[0].author.name, "오늘 상자는 자정까지");
    assert.equal(dm.body.components, undefined);
    const midnight = at("2026-10-28T00:00:00");
    assert.deepEqual(
      site.calls.find((c) => c[0] === "scheduleCleanup")[1].map((each) => each.deleteAt),
      [midnight, midnight],
    );
  });

  it("오후 11시가 아니면 자정 전 알림을 찾지 않는다", async () => {
    site.dueDailyDigests = async () => ({ card: null, users: [], guilds: [] });
    site.dueDailyReminders = async () => {
      throw new Error("부르면 안 됨");
    };
    const summary = await runDailyAlerts(env(), at("2026-10-27T22:00:00"));
    assert.equal(summary.reminders, undefined);
  });

  it("봇이 서버 채널에 쓸 수 없으면 그 서버의 매일 알림을 끈다", async () => {
    channelStatus = 403;
    site.guilds.set(GUILD, { dailyChannelId: CHANNEL, dailyHour: 7 });
    site.dueDailyDigests = async () => ({ card, users: [], guilds: [{ guildId: GUILD, channelId: CHANNEL }] });
    const summary = await runDailyAlerts(env(), at("2026-10-27T07:00:00"));
    assert.equal(summary.stopped, 1);
    assert.equal(site.guilds.get(GUILD).dailyChannelId, null);
  });

  it("받을 곳이 없으면 아무것도 보내지 않는다", async () => {
    site.dueDailyDigests = async () => ({ card: null, users: [], guilds: [] });
    assert.deepEqual(await runDailyAlerts(env(), at("2026-10-27T08:00:00")), { users: 0, guilds: 0, sent: 0, failed: 0, stopped: 0 });
    assert.equal(requests.length, 0);
  });
});

describe("지울 시각과 자정 전 알림 카드", () => {
  const at = (text) => Date.parse(`${text}+09:00`);
  it("다음에 오는 한국 시각 정각을 고른다", () => {
    assert.equal(nextKstHour(at("2026-10-27T07:00:00"), 7), at("2026-10-28T07:00:00"));
    assert.equal(nextKstHour(at("2026-10-27T06:00:00"), 7), at("2026-10-27T07:00:00"));
    assert.equal(nextKstHour(at("2026-10-27T23:00:00"), 0), at("2026-10-28T00:00:00"));
  });

  it("자정 전 알림은 오늘 상자만 아이콘과 함께 적는다", () => {
    const body = reminderView(card, new Map([["mk_lunchbox", "<:mk_lunchbox:1>"]]));
    assert.equal(body.embeds[0].author.name, "오늘 상자는 자정까지");
    assert.equal(body.embeds[0].description, "대용량 축복의 포션 1개\n<:mk_lunchbox:1> 로나의 특제 도시락 1개");
    assert.deepEqual(body.components, []);
  });
});
