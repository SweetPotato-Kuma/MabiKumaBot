import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { CONSENT_VERSION } from "../src/commands.js";
import { savedDetailView, savedListView } from "../src/saved.js";
import { ALICE, NOW, click, fakeSite, find, ids, run } from "./helpers.js";

const naktji = { keyword: "낙지", category: "", filterKey: "", exact: true };
const reforge = { keyword: "듀얼건", category: "", filterKey: "f", exact: false };
let site;

beforeEach(async () => {
  site = fakeSite();
  await site.registerUser(ALICE, CONSENT_VERSION);
});

const status = (searches) => ({
  checkedAt: NOW,
  searches: searches.map((search, index) => ({
    id: index + 1,
    name: search.name,
    query: search.query,
    conditions: search.conditions ?? [],
    alertOn: search.alertOn ?? true,
    url: "https://mabi.spkuma.com/auction?ref=bot",
    unavailable: false,
    lowest: 4290,
    total: 168,
    icon: index === 0 ? "https://icons.spkuma.com/f711.webp" : null,
    checkedAt: NOW,
  })),
});

describe("즐겨찾기 알림 목록", () => {
  it("검색마다 작은 카드에 아이콘, 최저가, 조건, 알림 상태를 보여 준다", () => {
    const body = savedListView(
      status([
        { name: "낙지", query: naktji },
        { name: "듀얼건 15", query: reforge, conditions: ["세공 듀얼건 최대 대미지 15레벨 이상"], alertOn: false },
      ]),
    );
    assert.match(body.content, /즐겨찾기 알림\*\* 2\/20/);
    assert.equal(body.embeds.length, 2);
    assert.deepEqual(body.embeds[0].author, {
      name: "낙지",
      url: "https://mabi.spkuma.com/auction?ref=bot",
      icon_url: "https://icons.spkuma.com/f711.webp",
    });
    assert.equal(body.embeds[1].author.icon_url, undefined);
    assert.match(body.embeds[0].description, /최저 \*\*4,290\*\* · 매물 168개/);
    assert.match(body.embeds[1].description, /"듀얼건", 세공 듀얼건 최대 대미지 15레벨 이상 · 새 매물 알림 꺼짐/);
    assert.deepEqual(find(body, "f:open").options.map((o) => o.description), ["새 매물 알림 켜짐", "새 매물 알림 꺼짐"]);
    assert.ok(ids(body).includes("https://mabi.spkuma.com/auction?ref=bot"));
    assert.ok(!ids(body).some((id) => ["f:new", "f:imp"].includes(id)));
  });

  it("열 개가 넘으면 쪽으로 나누고, 비어 있으면 사이트에서 등록하라고 한 줄로 알린다", () => {
    const many = status(Array.from({ length: 13 }, (_, i) => ({ name: `검색${i}`, query: { ...naktji, keyword: `검색${i}` } })));
    const first = savedListView(many, 0);
    assert.equal(first.embeds.length, 10);
    assert.equal(find(first, "f:pg:-1").disabled, true);
    const second = savedListView(many, 1);
    assert.equal(second.embeds.length, 3);
    assert.equal(find(second, "f:pg:2").disabled, true);

    const empty = savedListView(status([]));
    assert.match(empty.content, /종 단추로 등록하세요/);
    assert.equal(find(empty, "f:open"), undefined);
  });

  it("메뉴에서 열면 처리 중으로 답하고 목록을 채운다", async () => {
    await site.saveSearch(ALICE, { ...naktji, name: "낙지" });
    const opened = await run(site, click("m:fav"));
    assert.equal(opened.initial.type, 6);
    assert.equal(opened.edit.embeds[0].author.name, "낙지");
  });
});

describe("검색 하나", () => {
  it("조건과 최저가 매물, 알림 끄기, 지우기, 사이트에서 열기를 단다", () => {
    const search = {
      id: 3,
      name: "듀얼건 15",
      query: reforge,
      conditions: ["세공 듀얼건 최대 대미지 15레벨 이상"],
      alertOn: true,
      url: "https://mabi.spkuma.com/auction?keyword=듀얼건&ref=bot",
    };
    const result = {
      lowest: 70000000,
      total: 18,
      icon: null,
      checkedAt: NOW,
      items: [{ name: "앤티크 우든 듀얼건", price: 70000000, count: 1, notes: ["세공 듀얼건 최대 대미지 17"] }],
    };
    const body = savedDetailView(search, result);
    assert.match(body.embeds[0].description, /검색어 \*\*듀얼건\*\*/);
    assert.match(body.embeds[0].description, /• 세공 듀얼건 최대 대미지 15레벨 이상/);
    assert.match(body.embeds[0].description, /최저 \*\*70,000,000\*\* · 매물 18개/);
    assert.match(body.embeds[0].description, /세공 듀얼건 최대 대미지 17/);
    assert.deepEqual(ids(body), ["f:al:3:0", "f:del:3", search.url, "f:pg:0", "m:menu"]);
    assert.equal(find(body, "f:al:3:0").label, "새 매물 알림 끄기");
    assert.equal(savedDetailView({ ...search, alertOn: false }, result).components[0].components[0].label, "새 매물 알림 켜기");
  });

  it("알림 끄기를 누르면 사이트에 알리고 상세를 다시 보여 준다", async () => {
    const { search } = await site.saveSearch(ALICE, { ...naktji, name: "낙지" });
    const off = await run(site, click(`f:al:${search.id}:0`));
    assert.deepEqual(site.calls.find((c) => c[0] === "setSearchAlert"), ["setSearchAlert", ALICE, search.id, false]);
    assert.equal(off.edit.content, "새 매물 알림을 껐습니다.");
    assert.equal(off.edit.embeds[0].author.icon_url, "https://icons.spkuma.com/f711.webp");
  });

  it("삭제는 한 번 더 묻고 확인하면 지운 뒤 목록으로 간다", async () => {
    const { search } = await site.saveSearch(ALICE, { ...naktji, name: "낙지" });
    const asked = await run(site, click(`f:del:${search.id}`));
    assert.match(asked.view.content, /지울까요/);
    const done = await run(site, click(`f:delok:${search.id}`));
    assert.deepEqual(site.calls.find((c) => c[0] === "removeSearch"), ["removeSearch", ALICE, search.id]);
    assert.match(done.edit.content, /등록한 검색이 없습니다/);
  });

  it("예전 화면의 단추는 만료로 안내한다", async () => {
    for (const old of ["f:new", "f:imp", "f:edit:1", "f:meta:1", "f:off:1", "q:kw", "k:add"]) {
      assert.match((await run(site, click(old))).view.content, /만료된 단추/, old);
    }
  });
});
