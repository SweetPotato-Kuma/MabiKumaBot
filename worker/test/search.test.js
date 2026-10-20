import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  EMPTY_QUERY,
  conditionComponent,
  resetCategoryTreeForTest,
  searchButtons,
  searchCard,
  searchComponent,
  searchModal,
  specOf,
  stateOf,
  stateUrl,
} from "../src/search.js";

const NOW = Date.parse("2026-10-20T14:20:00+09:00");
const PAIR = "\u001f";

/** 사이트 Worker 의 검색 창구를 흉내 낸다. 상세 조건은 spec 을 JSON 으로 이어 붙여 흉내 낸다. */
function searchSite() {
  const calls = [];
  const site = {
    calls,
    summary: null,
    catalog: {
      conditions: [],
      entries: [
        {
          label: "세공 옵션",
          kind: "reforge",
          optionType: "세공 옵션",
          count: 2,
          values: [{ value: "스매시 대미지", count: 2 }],
          subTypes: [],
          valuesBySub: {},
          thresholds: { "스매시 대미지": [{ value: 5, count: 1 }, { value: 2, count: 2 }], "": [{ value: 5, count: 1 }] },
        },
        {
          label: "인챈트",
          kind: "enchant",
          optionType: "인챈트",
          count: 1,
          values: [],
          subTypes: ["접두"],
          valuesBySub: { 접두: [{ value: "엘리트", count: 1 }] },
          thresholds: {},
        },
        { label: "최대 공격", kind: "number", optionType: "공격", count: 2, values: [], subTypes: [], valuesBySub: {}, thresholds: { "": [{ value: 30, count: 1 }] } },
        { label: "펫 정보", kind: "pet", optionType: "펫 정보", count: 1, values: [{ value: "고양이", count: 1 }], subTypes: ["종족명", "레벨"], valuesBySub: {}, thresholds: { 레벨: [{ value: 20, count: 1 }] } },
        { label: "색상", kind: "color", optionType: "색상", count: 1, values: [], subTypes: [], valuesBySub: {}, thresholds: {} },
      ],
    },
    async searchAuction(query, options) {
      calls.push(["searchAuction", query, options]);
      const ready = Boolean(query.keyword || query.category);
      return {
        query,
        conditions: query.filterKey ? query.filterKey.split(";").map((spec) => JSON.parse(spec).kind) : [],
        ready,
        total: ready ? 2 : 0,
        scanned: 2,
        truncated: false,
        checkedAt: NOW,
        lowest: ready ? 100 : null,
        items: ready
          ? [
              { name: "롱 소드", itemName: "롱 소드", price: 100, count: 1, notes: ["세공 스매시 대미지 5레벨"] },
              { name: "롱 소드", itemName: "롱 소드", price: 2500, count: 3, notes: [] },
            ]
          : [],
      };
    },
    async searchCatalog(query) {
      calls.push(["searchCatalog", query]);
      return { ...site.catalog, query };
    },
    async addSearchCondition(query, spec) {
      calls.push(["addSearchCondition", query, spec]);
      return { ...query, filterKey: [query.filterKey, JSON.stringify(spec)].filter(Boolean).join(";") };
    },
    async removeSearchCondition(query, index) {
      calls.push(["removeSearchCondition", query, index]);
      const parts = query.filterKey.split(";");
      parts.splice(index, 1);
      return { ...query, filterKey: parts.join(";") };
    },
    async categoryTree() {
      calls.push(["categoryTree"]);
      return [
        { name: "근거리 장비", key: "group:근거리 장비", categories: ["한손 장비", "검"] },
        { name: "갑옷 장비", key: "group:갑옷 장비", categories: ["중갑옷", "천옷"] },
      ];
    },
    async marketSummary(name) {
      calls.push(["marketSummary", name]);
      return site.summary;
    },
  };
  return site;
}

const interaction = (query, { sid = null, customId = "", values } = {}) => ({
  type: 3,
  token: "t",
  member: { user: { id: "111111111111111111" } },
  message: { embeds: [{ url: stateUrl(query, sid) }] },
  data: { custom_id: customId, ...(values ? { values } : {}) },
});
const ids = (body) => (body.components ?? []).flatMap((line) => line.components).map((c) => c.custom_id ?? c.url);
const find = (body, id) => (body.components ?? []).flatMap((line) => line.components).find((c) => c.custom_id === id);
const finish = async (result) => (result.defer ? result.run() : result.body.data);

let site;
let env;

beforeEach(() => {
  site = searchSite();
  env = { SITE: site };
  resetCategoryTreeForTest();
});

describe("검색 상태", () => {
  it("사이트 주소에 조건을 담고 다시 읽는다", () => {
    const query = { keyword: "블래스트", category: "group:마법 장비", filterKey: "f=1&x", exact: true };
    const url = stateUrl(query, 7);

    assert.ok(url.startsWith("https://mabi.spkuma.com/auction?"));
    assert.equal(new URL(url).searchParams.get("ref"), "bot");
    assert.deepEqual(stateOf({ message: { embeds: [{ url }] } }), { query, sid: 7 });
  });

  it("카드가 없으면 빈 검색이다", () => {
    assert.deepEqual(stateOf({}), { query: EMPTY_QUERY, sid: null });
  });
});

describe("결과 카드", () => {
  it("조건과 싼 순 결과, 맞은 옵션, 매물 수와 읽은 시각을 보여 준다", async () => {
    const result = await site.searchAuction({ keyword: "롱 소드", category: "group:근거리 장비", filterKey: "", exact: true });
    result.conditions = ["세공 스매시 대미지 5레벨 이상"];
    const card = searchCard(result, { stats: "최근 24시간 거래 12건, 중위가 **300**" });

    assert.match(card.description, /^검색어 \*\*롱 소드\*\* \(정확히 일치\)\n분류 \*\*근거리 장비 전체\*\*\n상세 조건\n• 세공 스매시 대미지 5레벨 이상\n최근 24시간 거래 12건/);
    assert.match(card.description, /\*\*1\.\*\* 100 롱 소드\n　세공 스매시 대미지 5레벨\n\*\*2\.\*\* 2,500 롱 소드 ×3/);
    assert.equal(card.footer.text, "조건에 맞는 매물 2개");
    assert.equal(card.timestamp, new Date(NOW).toISOString());
    assert.equal(card.title, "경매장 검색");
    assert.equal(stateOf({ message: { embeds: [card] } }).query.keyword, "롱 소드");
  });

  it("조건이 없거나 결과가 없으면 그렇게 적는다", async () => {
    assert.match(searchCard(await site.searchAuction(EMPTY_QUERY)).description, /검색어나 분류를 정하면/);
    const none = { ...(await site.searchAuction({ ...EMPTY_QUERY, keyword: "x" })), total: 0, items: [] };
    assert.match(searchCard(none).description, /조건에 맞는 매물이 없습니다/);
    const cut = { ...none, total: 5, truncated: true };
    assert.match(searchCard(cut).footer.text, /앞쪽 일부만 읽음/);
  });

  it("단추는 조건이 없으면 저장과 공유를 끄고, 검색어가 없으면 정확히 일치를 끈다", () => {
    const empty = { components: searchButtons(EMPTY_QUERY) };
    assert.equal(find(empty, "q:save").disabled, true);
    assert.equal(find(empty, "q:share").disabled, true);
    assert.equal(find(empty, "q:exact").disabled, true);

    const editing = { components: searchButtons({ ...EMPTY_QUERY, category: "검" }, { sid: 3, ready: true, conditionCount: 2 }) };
    assert.equal(find(editing, "q:save").label, "저장 검색 고치기");
    assert.equal(find(editing, "q:cond").label, "상세 조건 2");
    assert.ok(find(editing, "f:show:3"));
    assert.ok(ids(editing).some((id) => id.startsWith("https://mabi.spkuma.com/auction?category=") && !id.includes("sid=")));
  });
});

describe("검색어, 분류, 정확히 일치", () => {
  it("검색어 단추는 지금 검색어를 채운 입력창을 열고, 제출하면 그 검색어로 다시 찾는다", async () => {
    const opened = await searchComponent(env, interaction({ ...EMPTY_QUERY, keyword: "낙지" }), "kw", []);
    assert.equal(opened.body.type, 9);
    assert.equal(opened.body.data.components[0].components[0].value, "낙지");

    const submitted = await searchModal(env, interaction({ ...EMPTY_QUERY, keyword: "낙지", exact: true }, { sid: 4 }), "q", "kwm", "", { keyword: " 문어 " });
    assert.equal(submitted.defer, "update");
    const body = await submitted.run();
    assert.deepEqual(site.calls.find((c) => c[0] === "searchAuction")[1], { ...EMPTY_QUERY, keyword: "문어", exact: true });
    assert.match(body.embeds[0].url, /sid=4/);

    await (await searchModal(env, interaction({ ...EMPTY_QUERY, keyword: "낙지", exact: true }), "q", "kwm", "", { keyword: "" })).run();
    assert.deepEqual(site.calls.at(-1)[1], EMPTY_QUERY);
  });

  it("분류는 묶음을 고른 뒤 그 안의 분류나 묶음 전체를 고르고, 카드는 그대로 둔다", async () => {
    const start = interaction({ ...EMPTY_QUERY, category: "검" });
    const panel = (await searchComponent(env, start, "cat", [])).body.data;
    assert.deepEqual(panel.embeds, start.message.embeds);
    assert.equal(find(panel, "q:grp").options.find((o) => o.default).label, "근거리 장비");
    assert.deepEqual(find(panel, "q:catpick").options.map((o) => [o.value, Boolean(o.default)]), [
      ["group:근거리 장비", false],
      ["한손 장비", false],
      ["검", true],
    ]);
    assert.ok(find(panel, "q:catclear"));

    const second = (await searchComponent(env, start, "grp", ["1"])).body.data;
    assert.deepEqual(find(second, "q:catpick").options.map((o) => o.label), ["갑옷 장비 전체", "중갑옷", "천옷"]);
    assert.equal(site.calls.filter((c) => c[0] === "categoryTree").length, 1);

    await (await searchComponent(env, start, "catpick", ["group:갑옷 장비"])).run();
    assert.equal(site.calls.at(-1)[1].category, "group:갑옷 장비");
    await (await searchComponent(env, start, "catclear", [])).run();
    assert.equal(site.calls.at(-1)[1].category, "");
  });

  it("분류가 없으면 분류 지우기 단추가 없다", async () => {
    const panel = (await searchComponent(env, interaction(EMPTY_QUERY), "cat", [])).body.data;
    assert.equal(find(panel, "q:catclear"), undefined);
    assert.equal(find(panel, "q:catpick"), undefined);
  });

  it("정확히 일치를 켜고 끄고, 초기화하면 조건을 모두 지운다", async () => {
    const state = interaction({ ...EMPTY_QUERY, keyword: "낙지", category: "음식" });
    await (await searchComponent(env, state, "exact", [])).run();
    assert.equal(site.calls.at(-1)[1].exact, true);
    await (await searchComponent(env, state, "reset", [])).run();
    assert.deepEqual(site.calls.at(-1)[1], EMPTY_QUERY);
  });

  it("공유는 모두에게 보이는 새 메시지로 카드와 사이트 링크만 올린다", async () => {
    const shared = await searchComponent(env, interaction({ ...EMPTY_QUERY, keyword: "낙지" }), "share", []);
    assert.equal(shared.defer, "public");
    const body = await shared.run();
    assert.equal(body.embeds.length, 1);
    assert.ok(ids(body).every((id) => id.startsWith("https://")));
  });

  it("정확히 일치하는 아이템 검색에는 거래 기록 요약을 붙인다", async () => {
    site.summary = { day: { n: 1234, mid: 4200 } };
    const body = await (await searchComponent(env, interaction({ ...EMPTY_QUERY, keyword: "낙지", exact: true }), "refresh", [])).run();
    assert.match(body.embeds[0].description, /최근 24시간 거래 1,234건, 중위가 \*\*4,200\*\*/);

    await (await searchComponent(env, interaction({ ...EMPTY_QUERY, keyword: "낙지" }), "refresh", [])).run();
    assert.equal(site.calls.filter((c) => c[0] === "marketSummary").length, 1);
  });
});

describe("상세 조건", () => {
  const base = { ...EMPTY_QUERY, category: "검" };

  it("조건 패널은 지금 조건 빼기와 결과에서 뽑은 조건 더하기를 보여 준다", async () => {
    site.catalog.conditions = ["세공 스매시 대미지 5레벨 이상"];
    const body = await (await searchComponent(env, interaction(base), "cond", [])).run();

    assert.deepEqual(find(body, "k:rm").options.map((o) => [o.label, o.value]), [["세공 스매시 대미지 5레벨 이상", "0"]]);
    const add = find(body, "k:add");
    assert.deepEqual(add.options.map((o) => o.value), ["reforge|세공 옵션", "enchant|인챈트", "number|공격", "pet|펫 정보", "color|색상"]);
    assert.equal(add.options[0].description, "매물 2개에 있음");
    assert.equal(add.options[4].description, "사이트에서 정합니다");
    assert.equal(body.embeds.length, 1);
  });

  it("세공은 이름을 고르고 레벨 문턱을 고르면 조건을 더해 다시 검색한다", async () => {
    const state = interaction(base, { sid: 9 });
    const step1 = await (await conditionComponent(env, state, "add", "", ["reforge|세공 옵션"])).run();
    const names = find(step1, "k:v:reforge|세공 옵션");
    assert.deepEqual(names.options.map((o) => o.label), ["아무 세공", "스매시 대미지"]);

    const step2 = await (await conditionComponent(env, state, "v", "reforge|세공 옵션", ["스매시 대미지"])).run();
    const levels = find(step2, "k:t:reforge|세공 옵션|스매시 대미지");
    assert.deepEqual(levels.options.map((o) => [o.label, o.value, o.description]), [
      ["레벨 상관없음", "*", undefined],
      ["5레벨 이상", "5", "1개"],
      ["2레벨 이상", "2", "2개"],
    ]);
    assert.ok(find(step2, "k:man:reforge|세공 옵션|스매시 대미지"));

    const done = await (await conditionComponent(env, state, "t", "reforge|세공 옵션|스매시 대미지", ["5"])).run();
    assert.deepEqual(site.calls.find((c) => c[0] === "addSearchCondition")[2], {
      kind: "reforge",
      optionType: "세공 옵션",
      name: "스매시 대미지",
      minLevel: 5,
    });
    assert.match(done.embeds[0].url, /sid=9/);
    assert.equal(site.calls.at(-1)[0], "searchAuction");
  });

  it("아무 세공을 고르면 레벨 상관없음 없이 문턱만 고른다", async () => {
    const step2 = await (await conditionComponent(env, interaction(base), "v", "reforge|세공 옵션", ["*"])).run();
    const levels = find(step2, "k:t:reforge|세공 옵션|*");
    assert.deepEqual(levels.options.map((o) => o.value), ["5"]);
  });

  it("인챈트는 접두나 접미 이름을 고르면 바로 더한다", async () => {
    const step1 = await (await conditionComponent(env, interaction(base), "add", "", ["enchant|인챈트"])).run();
    assert.deepEqual(find(step1, "k:v:enchant|인챈트").options.map((o) => o.label), ["접두 엘리트"]);

    await (await conditionComponent(env, interaction(base), "v", "enchant|인챈트", [`접두${PAIR}엘리트`])).run();
    assert.deepEqual(site.calls.find((c) => c[0] === "addSearchCondition")[2], { kind: "enchant", optionType: "인챈트", prefix: "엘리트" });
  });

  it("숫자 옵션은 바로 문턱을 고르고, 문턱 없이 직접 입력도 된다", async () => {
    const step = await (await conditionComponent(env, interaction(base), "add", "", ["number|공격"])).run();
    assert.ok(find(step, "k:t:number|공격|"));
    assert.equal(find(step, "k:t:number|공격|").options[0].value, "30");

    const opened = await conditionComponent(env, interaction(base), "man", "number|공격|", []);
    assert.equal(opened.body.data.custom_id, "k:mm:number|공격|");
    await (await searchModal(env, interaction(base), "k", "mm", "number|공격|", { min: "1,500" })).run();
    assert.deepEqual(site.calls.find((c) => c[0] === "addSearchCondition")[2], { kind: "number", optionType: "공격", min: 1500 });

    const wrong = await searchModal(env, interaction(base), "k", "mm", "number|공격|", { min: "많이" });
    assert.match(wrong.body.data.content, /숫자로/);
  });

  it("펫은 종족을 고르면 종족 목록을, 다른 칸은 문턱을 보여 준다", async () => {
    const species = await (await conditionComponent(env, interaction(base), "v", "pet|펫 정보", ["종족명"])).run();
    const menu = find(species, "k:v:pet|펫 정보");
    assert.deepEqual(menu.options.map((o) => o.label), ["고양이"]);
    await (await conditionComponent(env, interaction(base), "v", "pet|펫 정보", [menu.options[0].value])).run();
    assert.deepEqual(site.calls.find((c) => c[0] === "addSearchCondition")[2], { kind: "pet", optionType: "펫 정보", field: "종족명", text: "고양이" });

    const level = await (await conditionComponent(env, interaction(base), "v", "pet|펫 정보", ["레벨"])).run();
    assert.deepEqual(find(level, "k:t:pet|펫 정보|레벨").options.map((o) => o.value), ["20"]);
  });

  it("색상은 사이트에서 정하라고 알려 준다", async () => {
    const body = await (await conditionComponent(env, interaction(base), "add", "", ["color|색상"])).run();
    assert.match(body.content, /사이트에서/);
  });

  it("조건을 빼면 다시 검색한다", async () => {
    const state = interaction({ ...base, filterKey: '{"kind":"a"};{"kind":"b"}' });
    const body = await (await conditionComponent(env, state, "rm", "", ["0"])).run();
    assert.deepEqual(site.calls.find((c) => c[0] === "removeSearchCondition").slice(2), [0]);
    assert.equal(body.embeds.length, 1);
  });

  it("결과에서 사라진 옵션을 고르면 다시 고르라고 한다", async () => {
    const body = await (await conditionComponent(env, interaction(base), "add", "", ["reforge|없는 옵션"])).run();
    assert.match(body.content, /다시 골라/);
  });
});

describe("조건 만들기", () => {
  it("종류마다 사이트가 받는 모양으로 만든다", () => {
    assert.deepEqual(specOf("reforge", "세공 옵션", "*", 3), { kind: "reforge", optionType: "세공 옵션", name: "", minLevel: 3 });
    assert.deepEqual(specOf("enchant", "인챈트", `접미${PAIR}의`, null), { kind: "enchant", optionType: "인챈트", suffix: "의" });
    assert.deepEqual(specOf("special", "특별 개조", "R", 6), { kind: "special", optionType: "특별 개조", type: "R", minStep: 6 });
    assert.deepEqual(specOf("erg", "에르그", "*", 25), { kind: "erg", optionType: "에르그", grade: "", minLevel: 25 });
    assert.deepEqual(specOf("sub", "토템 효과", "공격", 3), { kind: "sub", optionType: "토템 효과", sub: "공격", min: 3 });
    assert.deepEqual(specOf("text", "제작자", "쿠마", null), { kind: "text", optionType: "제작자", text: "쿠마" });
  });
});
