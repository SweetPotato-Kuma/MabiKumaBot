import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { runFavoriteAlerts } from "../src/alerts.js";
import { CONSENT_VERSION, handleAutocomplete, handleCommand } from "../src/commands.js";
import { chunkMessages } from "../src/format.js";

const ALICE = "111111111111111111";

/** 사이트 Worker 의 BotService 중 즐겨찾기 쪽을 흉내 낸다. 계약은 사이트 저장소의 favorites.test.js 가 확인한다. */
function fakeSite() {
  const users = new Set();
  const calls = [];
  const site = {
    calls,
    items: [],
    favorites: new Map(),
    status: { checkedAt: 1_700_000_000_000, items: [] },
    favoriteDue: [],
    async getUser(id) {
      return users.has(id) ? { id, arbeit: [], settings: {} } : null;
    },
    async registerUser(id) {
      users.add(id);
    },
    async markDmFailed(id) {
      calls.push(["markDmFailed", id]);
    },
    async updateSettings(id, patch) {
      calls.push(["updateSettings", id, patch]);
      return {};
    },
    async searchItems(query) {
      return site.items.filter((name) => name.startsWith(query));
    },
    async listFavorites(id) {
      return site.favorites.get(id) ?? [];
    },
    async addFavorite(id, name, target) {
      calls.push(["addFavorite", id, name, target]);
      if (name === "너무많음") throw new Error("즐겨찾기는 20개까지 둘 수 있습니다.");
      const list = site.favorites.get(id) ?? [];
      const found = list.find((favorite) => favorite.name === name);
      if (found) found.targetPrice = target === undefined ? found.targetPrice : target || null;
      else list.push({ name, targetPrice: target || null });
      site.favorites.set(id, list);
      return list;
    },
    async removeFavorite(id, name) {
      calls.push(["removeFavorite", id, name]);
      site.favorites.set(
        id,
        (site.favorites.get(id) ?? []).filter((favorite) => favorite.name !== name),
      );
    },
    async favoritesStatus() {
      return site.status;
    },
    async dueFavoriteAlerts(minuteIndex) {
      calls.push(["dueFavoriteAlerts", minuteIndex]);
      return site.favoriteDue;
    },
  };
  return site;
}

function nest(path, leaf) {
  if (path.length === 0) return leaf;
  const type = path.length === 1 ? 1 : 2;
  return [{ type, name: path[0], options: nest(path.slice(1), leaf) }];
}

const command = (path, values = {}) => ({
  type: 2,
  member: { user: { id: ALICE } },
  data: {
    name: path[0],
    options: nest(path.slice(1), Object.entries(values).map(([name, value]) => ({ name, value }))),
  },
});

const content = (reply) => reply.data.content;

describe("즐겨찾기 명령", () => {
  let site;
  let env;

  beforeEach(async () => {
    site = fakeSite();
    env = { SITE: site };
    await site.registerUser(ALICE, CONSENT_VERSION);
  });

  it("동의하기 전에는 동의 안내만 보여 준다", async () => {
    const other = fakeSite();
    const reply = await handleCommand(command(["구마", "즐겨찾기", "목록"]), { SITE: other });

    assert.match(content(reply), /동의가 필요합니다/);
    assert.equal(other.favorites.size, 0);
  });

  it("목표가를 정해 더하고, 목표가 0 이면 알림을 끈다", async () => {
    const first = await handleCommand(
      command(["구마", "즐겨찾기", "추가"], { 아이템: "낙지", 목표가: 4000 }),
      env,
    );
    assert.match(content(first), /\*\*낙지\*\* 즐겨찾기 \(1개\)/);
    assert.match(content(first), /개당 \*\*4,000\*\* 이하/);
    assert.deepEqual(site.calls.at(-1), ["addFavorite", ALICE, "낙지", 4000]);

    const off = await handleCommand(
      command(["구마", "즐겨찾기", "추가"], { 아이템: "낙지", 목표가: 0 }),
      env,
    );
    assert.match(content(off), /목표가를 정하면/);
    assert.deepEqual(site.favorites.get(ALICE), [{ name: "낙지", targetPrice: null }]);
  });

  it("목표가를 주지 않으면 사이트에 undefined 로 넘겨 기존 값을 지킨다", async () => {
    await handleCommand(command(["구마", "즐겨찾기", "추가"], { 아이템: "낙지" }), env);
    assert.deepEqual(site.calls.at(-1), ["addFavorite", ALICE, "낙지", undefined]);
  });

  it("사이트가 이유를 알려 주면 그대로 보여 주고 그 밖의 오류는 일반 문구로 답한다", async () => {
    const limit = await handleCommand(command(["구마", "즐겨찾기", "추가"], { 아이템: "너무많음" }), env);
    assert.match(content(limit), /20개까지/);

    site.addFavorite = async () => {
      throw new Error("db exploded");
    };
    const broken = await handleCommand(command(["구마", "즐겨찾기", "추가"], { 아이템: "낙지" }), env);
    assert.match(content(broken), /처리하지 못했습니다/);
  });

  it("삭제한다", async () => {
    await site.addFavorite(ALICE, "낙지", 1);
    const reply = await handleCommand(command(["구마", "즐겨찾기", "삭제"], { 아이템: "낙지" }), env);

    assert.match(content(reply), /뺐습니다/);
    assert.deepEqual(site.favorites.get(ALICE), []);
  });

  it("목록은 지금 최저가와 목표 가격, 읽은 시각을 보여 준다", async () => {
    const links = { item: "https://mabi.spkuma.com/item/a?ref=bot", auction: "https://x" };
    site.status = {
      checkedAt: 1_700_000_000_000,
      items: [
        {
          name: "낙지",
          targetPrice: 4300,
          lowest: { price: 4290, listings: 3 },
          unavailable: false,
          day: { mid: 4310 },
          links,
        },
        { name: "마나 허브", targetPrice: null, lowest: null, unavailable: true, day: null, links },
        {
          name: "빈 아이템",
          targetPrice: 100,
          lowest: { price: null, listings: 0 },
          unavailable: false,
          day: null,
          links,
        },
      ],
    };
    const text = content(await handleCommand(command(["구마", "즐겨찾기", "목록"]), env));

    assert.match(text, /\*\*내 즐겨찾기\*\* \(3개\)/);
    assert.match(
      text,
      /\[낙지\]\(<https:\/\/mabi\.spkuma\.com\/item\/a\?ref=bot>\) 최저 \*\*4,290\*\* \(매물 3개\) · 24시간 중위 4,310 · 목표 4,300 이하/,
    );
    assert.match(text, /\[마나 허브\]\(<[^>]+>\) 최저가를 읽지 못했습니다/);
    assert.match(text, /\[빈 아이템\]\(<[^>]+>\) 매물 없음 · 목표 100/);
    assert.match(text, /-# 넥슨 경매장 기준 <t:1700000000:R>/);
  });

  it("즐겨찾기가 많으면 줄이 길어지지 않게 링크를 뺀다", async () => {
    site.status = {
      checkedAt: 1_700_000_000_000,
      items: Array.from({ length: 12 }, (_, i) => ({
        name: `아이템${i}`,
        targetPrice: null,
        lowest: { price: 100, listings: 1 },
        unavailable: false,
        day: null,
        links: { item: "https://mabi.spkuma.com/item/x", auction: "https://x" },
      })),
    };
    const text = content(await handleCommand(command(["구마", "즐겨찾기", "목록"]), env));

    assert.doesNotMatch(text, /https:/);
    assert.ok(text.length < 2000);
  });

  it("비어 있으면 추가하는 방법을 알려 준다", async () => {
    const text = content(await handleCommand(command(["구마", "즐겨찾기", "목록"]), env));
    assert.match(text, /즐겨찾기가 없습니다/);
  });

  it("자동완성은 추가에서는 아이템 이름을, 삭제에서는 내 즐겨찾기만 보여 준다", async () => {
    site.items = ["낙지", "낙지 구이", "마나 허브"];
    await site.addFavorite(ALICE, "마나 허브", null);
    const focus = (path) => {
      const interaction = command(path, { 아이템: "낙" });
      let node = interaction.data;
      while (node.options?.[0]?.options) node = node.options[0];
      node.options[0].focused = true;
      return { ...interaction, type: 4 };
    };

    const add = await handleAutocomplete(focus(["구마", "즐겨찾기", "추가"]), env);
    assert.deepEqual(add.data.choices.map((c) => c.value), ["낙지", "낙지 구이"]);

    const remove = await handleAutocomplete(focus(["구마", "즐겨찾기", "삭제"]), env);
    assert.deepEqual(remove.data.choices, []);
  });

  it("내 정보 삭제 안내에 즐겨찾기가 들어 있다", async () => {
    const ask = await handleCommand(command(["구마", "내정보", "삭제"]), env);
    assert.match(content(ask), /즐겨찾기/);
  });
});

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

describe("목표 가격 알림 보내기", () => {
  const realFetch = globalThis.fetch;
  let site;
  let env;
  let requests;

  beforeEach(() => {
    site = fakeSite();
    env = { SITE: site, DISCORD_BOT_TOKEN: "test-token" };
    requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: "900000000000000001" }), { status: 200 });
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const item = (name, price) => ({
    name,
    price,
    listings: 3,
    target: price + 10,
    links: {
      item: `https://mabi.spkuma.com/item/${name}?ref=bot`,
      auction: `https://mabi.spkuma.com/auction?keyword=${name}&exact=1&ref=bot`,
    },
    checkedAt: 1_700_000_000_000,
  });
  const alert = (overrides = {}) => ({
    discordUserId: ALICE,
    digest: true,
    dmChannelId: "800000000000000002",
    items: [item("낙지", 4290), item("문어", 4800)],
    ...overrides,
  });

  it("분 번호를 넘겨 확인하고 대상이 없으면 보내지 않는다", async () => {
    const summary = await runFavoriteAlerts(env, 1_700_000_040_000);

    assert.deepEqual(site.calls[0], ["dueFavoriteAlerts", Math.floor(1_700_000_040_000 / 60_000)]);
    assert.deepEqual(summary, { users: 0, sent: 0, failed: 0, stopped: 0 });
    assert.equal(requests.length, 0);
  });

  it("묶어서 한 통으로 보내고 링크와 읽은 시각을 붙인다", async () => {
    site.favoriteDue = [alert()];
    const summary = await runFavoriteAlerts(env, 1_700_000_040_000);

    assert.equal(summary.sent, 1);
    const text = requests[0].body.content;
    assert.match(text, /^\*\*목표 가격 도달\*\*/);
    assert.match(
      text,
      /\[낙지\]\(<https:\/\/mabi\.spkuma\.com\/item\/낙지\?ref=bot>\) 최저 \*\*4,290\*\* \(목표 4,300\) · 매물 3개 · \[경매장\]\(<https:\/\/mabi\.spkuma\.com\/auction\?keyword=낙지&exact=1&ref=bot>\)/,
    );
    assert.match(text, /-# 넥슨 경매장 기준 <t:1700000000:R>/);
    assert.match(text, /\/구마 알림설정/);
  });

  it("묶어 받지 않는 사람은 아이템마다 따로 받는다", async () => {
    site.favoriteDue = [alert({ digest: false })];
    const summary = await runFavoriteAlerts(env, 1_700_000_040_000);

    assert.equal(summary.sent, 2);
    assert.match(requests[0].body.content, /낙지/);
    assert.match(requests[1].body.content, /문어/);
  });

  it("DM 이 막힌 사람은 멈춘다", async () => {
    site.favoriteDue = [alert()];
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 50007 }), { status: 403 });

    const summary = await runFavoriteAlerts(env, 1_700_000_040_000);

    assert.deepEqual(summary, { users: 1, sent: 0, failed: 0, stopped: 1 });
    assert.deepEqual(
      site.calls.find((c) => c[0] === "markDmFailed"),
      ["markDmFailed", ALICE],
    );
  });
});
