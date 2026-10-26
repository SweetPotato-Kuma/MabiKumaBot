import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { CONSENT_VERSION } from "../src/commands.js";
import { priceView } from "../src/price.js";
import { ALICE, click, fakeSite, find, ids, run, slash, submit } from "./helpers.js";

const card = {
  name: "낙지",
  day: { n: 6895, mid: 4400 },
  lowest: { price: 4450, listings: 168 },
  change: { from: 4300, to: 4390, percent: 2.1 },
  icon: "https://icons.spkuma.com/f711.webp",
  links: { item: "https://mabi.spkuma.com/item/낙지?ref=bot", auction: "https://mabi.spkuma.com/auction?keyword=낙지&ref=bot" },
  charts: {
    candle: "https://mabi-api.spkuma.com/market/chart.png?name=낙지&style=candle&t=1",
    line: "https://mabi-api.spkuma.com/market/chart.png?name=낙지&style=line&t=1",
  },
};
let site;

beforeEach(() => {
  site = fakeSite();
  site.cards = { 낙지: card };
  site.items = ["낙지", "낙지 다리"];
});

describe("시세 카드", () => {
  it("아이콘, 최저가, 24시간 거래, 7일 등락과 차트 그림을 보여 준다", () => {
    const body = priceView(card, "candle");
    const [embed] = body.embeds;
    assert.deepEqual(embed.author, { name: "낙지", url: card.links.item, icon_url: card.icon });
    assert.match(embed.description, /최저가 \*\*4,450\*\* · 매물 168개/);
    assert.match(embed.description, /24시간 거래 6,895건, 중위가 \*\*4,400\*\*/);
    assert.match(embed.description, /7일 ▲ 2\.1% \(4,300 → 4,390\)/);
    assert.equal(embed.image.url, card.charts.candle);
    assert.equal(embed.footer.text, "최근 7일 4시간 봉");
    assert.deepEqual(ids(body), ["p:s:line:낙지", "p:r:candle:낙지", card.links.item, "m:menu"]);
    assert.equal(find(body, "p:s:line:낙지").label, "선으로 보기");
  });

  it("내렸으면 ▼, 매물이 없으면 그렇다고 쓰고, 선 그림에는 캔들로 보기를 단다", () => {
    const body = priceView({ ...card, lowest: { price: null, listings: 0 }, change: { from: 4400, to: 4300, percent: -2.3 } }, "line");
    assert.match(body.embeds[0].description, /지금 올라온 매물이 없습니다/);
    assert.match(body.embeds[0].description, /7일 ▼ 2\.3%/);
    assert.equal(body.embeds[0].image.url, card.charts.line);
    assert.equal(find(body, "p:s:candle:낙지").label, "캔들로 보기");
  });
});

describe("시세 보기 흐름", () => {
  it("메뉴의 시세 보기는 이름 입력창을 열고, 제출하면 카드로 바꾼다", async () => {
    const opened = await run(site, click("m:price"));
    assert.equal(opened.initial.type, 9);
    assert.equal(opened.view.custom_id, "p:m");
    const shown = await run(site, { ...submit("p:m", { name: "낙지" }), message: { embeds: [] } });
    assert.equal(shown.initial.type, 6);
    assert.equal(shown.edit.embeds[0].image.url, card.charts.candle);
  });

  it("예전 메뉴의 경매장 검색 단추도 시세 보기를 연다", async () => {
    assert.equal((await run(site, click("m:search"))).view.custom_id, "p:m");
  });

  it("/마비쿠마 아이템:낙지 는 처리 중으로 답한 뒤 새 메시지에 카드를 채운다", async () => {
    const result = await run(site, slash({ 아이템: "낙지" }));
    assert.equal(result.initial.type, 5);
    assert.equal(result.edit.embeds[0].author.name, "낙지");
  });

  it("기록이 없으면 그 글자로 시작하는 아이템을 고르게 하고, 고르면 카드를 연다", async () => {
    site.cards = { "낙지 다리": { ...card, name: "낙지 다리" } };
    const picked = await run(site, slash({ 아이템: "낙지" }));
    assert.match(picked.edit.content, /\*\*낙지\*\* 로 찾은 아이템/);
    assert.deepEqual(find(picked.edit, "p:pick").options.map((o) => o.value), ["낙지 다리"]);

    const opened = await run(site, click("p:pick", ["낙지 다리"]));
    assert.equal(opened.edit.embeds[0].author.name, "낙지 다리");

    site.items = [];
    const none = await run(site, slash({ 아이템: "고래" }));
    assert.match(none.edit.content, /거래 기록을 찾지 못했습니다/);
    assert.ok(find(none.edit, "p:ask"));
  });

  it("모양을 바꾸면 그림만 바꾸고, 동의한 사용자는 다음에도 그 모양으로 본다", async () => {
    const guest = await run(site, click("p:s:line:낙지"));
    assert.equal(guest.edit.embeds[0].image.url, card.charts.line);
    assert.equal(site.calls.find((c) => c[0] === "updateSettings"), undefined);

    await site.registerUser(ALICE, CONSENT_VERSION);
    await run(site, click("p:s:line:낙지"));
    assert.deepEqual(site.calls.find((c) => c[0] === "updateSettings"), ["updateSettings", ALICE, { chartStyle: "line" }]);
    const again = await run(site, slash({ 아이템: "낙지" }));
    assert.equal(again.edit.embeds[0].image.url, card.charts.line);

    const refreshed = await run(site, click("p:r:candle:낙지"));
    assert.equal(refreshed.edit.embeds[0].image.url, card.charts.candle);
  });
});
