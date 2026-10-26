import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { saveFromSearch, savedComponent, savedDetailView, savedListView, savedModal } from "../src/saved.js";
import { EMPTY_QUERY, stateUrl } from "../src/search.js";

const NOW = Date.parse("2026-10-20T14:20:00+09:00");
const ALICE = "111111111111111111";

const result = (query, lowest = 4290) => ({
  query,
  conditions: [],
  ready: true,
  total: lowest === null ? 0 : 3,
  scanned: 3,
  truncated: false,
  checkedAt: NOW,
  lowest,
  items: lowest === null ? [] : [{ name: "낙지", itemName: "낙지", price: lowest, count: 1, notes: [] }],
});

/** 사이트 Worker 의 저장 검색 창구를 흉내 낸다. */
function savedSite() {
  const calls = [];
  const searches = [];
  let nextId = 1;
  const site = {
    calls,
    searches,
    registered: true,
    linked: true,
    importResult: { added: [], existing: 0, invalid: 0, full: 0 },
    async getUser() {
      return site.registered ? { id: ALICE } : null;
    },
    async linkStatus() {
      return { linked: site.linked };
    },
    async listSearches() {
      return searches.map((search) => ({ ...search }));
    },
    async saveSearch(uid, input) {
      calls.push(["saveSearch", uid, input]);
      const { id, name, targetPrice, ...query } = input;
      if (id) {
        const found = searches.find((search) => search.id === id);
        Object.assign(found, { query, name: name ?? found.name, targetPrice: targetPrice || null });
        return { search: found, created: false };
      }
      const same = searches.find((search) => JSON.stringify(search.query) === JSON.stringify(query));
      if (same) return { search: same, created: false };
      const search = { id: nextId++, name, query, targetPrice: targetPrice || null, conditions: [] };
      searches.push(search);
      return { search, created: true };
    },
    async removeSearch(uid, id) {
      calls.push(["removeSearch", uid, id]);
      searches.splice(searches.findIndex((search) => search.id === id), 1);
      return searches;
    },
    async searchesStatus() {
      return { checkedAt: NOW, searches: searches.map((search) => ({ ...search, unavailable: false, lowest: 4290, total: 3, checkedAt: NOW })) };
    },
    async searchDetail(uid, id) {
      calls.push(["searchDetail", uid, id]);
      const search = searches.find((each) => each.id === id);
      return { search, result: result(search.query) };
    },
    async searchAuction(query) {
      calls.push(["searchAuction", query]);
      return query.keyword || query.category ? result(query) : { ...result(query, null), ready: false };
    },
    async marketSummary() {
      return null;
    },
    async importSiteSearches(uid) {
      calls.push(["importSiteSearches", uid]);
      return site.importResult;
    },
  };
  return site;
}

const interaction = (query = EMPTY_QUERY, sid = null) => ({
  type: 3,
  token: "t",
  member: { user: { id: ALICE } },
  message: { embeds: [{ url: stateUrl(query, sid) }] },
  data: { custom_id: "" },
});
const ids = (body) => (body.components ?? []).flatMap((line) => line.components).map((c) => c.custom_id ?? c.url);
const find = (body, id) => (body.components ?? []).flatMap((line) => line.components).find((c) => c.custom_id === id);

let site;
let env;
const naktji = { keyword: "낙지", category: "", filterKey: "", exact: true };

beforeEach(() => {
  site = savedSite();
  env = { SITE: site };
});

describe("목록", () => {
  it("검색마다 최저가와 목표가, 조건 요약을 보여 주고 선택 메뉴로 연다", async () => {
    await site.saveSearch(ALICE, { ...naktji, name: "낙지", targetPrice: 4300 });
    await site.saveSearch(ALICE, { keyword: "", category: "group:갑옷 장비", filterKey: "f", exact: false, name: "갑옷" });
    site.searches[1].conditions = ["세공 스매시 대미지 5레벨 이상"];
    const body = savedListView(await site.searchesStatus());

    assert.match(body.embeds[0].description, /\*\*낙지\*\* 최저 \*\*4,290\*\* \/ 목표 4,300 이하\n　"낙지" 정확히/);
    assert.match(body.embeds[0].description, /\*\*갑옷\*\* 최저 \*\*4,290\*\*\n　갑옷 장비 전체, 상세 조건 1개/);
    assert.equal(body.embeds[0].footer.text, "2/20");
    assert.deepEqual(find(body, "f:open").options.map((o) => [o.label, o.value, o.description]), [
      ["낙지", "1", "목표 4,300"],
      ["갑옷", "2", "목표가 없음"],
    ]);
    assert.deepEqual(ids(body).slice(-4), ["f:new", "f:imp", "m:fav", "m:menu"]);
  });

  it("비어 있으면 저장하는 방법을 알려 주고 선택 메뉴가 없다", async () => {
    const body = savedListView(await site.searchesStatus());
    assert.match(body.embeds[0].description, /저장한 검색이 없습니다/);
    assert.equal(find(body, "f:open"), undefined);
  });
});

describe("상세", () => {
  it("결과 카드 위에 목표가 상태를 적고 고치기 단추를 단다", async () => {
    const { search } = await site.saveSearch(ALICE, { ...naktji, name: "낙지", targetPrice: 4300 });
    const body = savedDetailView(search, result(naktji, 4290), "저장했습니다.");

    assert.equal(body.content, "저장했습니다.");
    assert.equal(body.embeds[0].title, "낙지");
    assert.match(body.embeds[0].description, /^목표 \*\*4,300\*\*, 지금 목표 이하입니다/);
    assert.match(body.embeds[0].url, /sid=1/);
    assert.deepEqual(ids(body).slice(0, 4), ["f:meta:1", "f:edit:1", "f:off:1", "f:del:1"]);
    assert.ok(find(body, "q:share"));
  });

  it("목표가가 없으면 알림이 오지 않는다고 적고 목표가 끄기를 끈다", async () => {
    const { search } = await site.saveSearch(ALICE, { ...naktji, name: "낙지" });
    const body = savedDetailView(search, result(naktji, null));
    assert.match(body.embeds[0].description, /목표가가 없어 알림이 오지 않습니다/);
    assert.equal(find(body, "f:off:1").disabled, true);
  });

  it("목록에서 고르면 처리 중으로 답하고 상세를 채운다", async () => {
    await site.saveSearch(ALICE, { ...naktji, name: "낙지" });
    const opened = await savedComponent(env, interaction(), "open", "", ["1"]);
    assert.equal(opened.defer, "update");
    assert.equal((await opened.run()).embeds[0].title, "낙지");
  });
});

describe("저장", () => {
  it("검색 화면의 저장 단추는 검색어나 분류를 이름으로 채운 입력창을 연다", async () => {
    const opened = await saveFromSearch(env, interaction({ ...EMPTY_QUERY, category: "group:갑옷 장비" }));
    assert.equal(opened.body.data.custom_id, "f:savem");
    assert.equal(opened.body.data.components[0].components[0].value, "갑옷 장비");
  });

  it("고치는 중이면 그 검색의 이름과 목표가를 채운다", async () => {
    await site.saveSearch(ALICE, { ...naktji, name: "내 낙지", targetPrice: 4300 });
    const opened = await saveFromSearch(env, interaction(naktji, 1));
    assert.equal(opened.body.data.custom_id, "f:savem:1");
    assert.deepEqual(opened.body.data.components.map((line) => line.components[0].value), ["내 낙지", "4300"]);
  });

  it("동의하지 않았으면 동의 화면을 새 메시지로 보여 준다", async () => {
    site.registered = false;
    const opened = await saveFromSearch(env, interaction(naktji));
    assert.equal(opened.body.type, 4);
    assert.match(opened.body.data.content, /동의가 필요합니다/);
  });

  it("제출하면 카드의 조건으로 저장하고 상세를 보여 준다", async () => {
    const saved = await savedModal(env, interaction(naktji), "savem", "", { name: "낙지", target: "4,300" });
    const body = await saved.run();
    assert.deepEqual(site.calls.find((c) => c[0] === "saveSearch")[2], { ...naktji, name: "낙지", targetPrice: 4300 });
    assert.equal(body.content, "즐겨찾기에 저장했습니다.");
    assert.equal(body.embeds[0].title, "낙지");
  });

  it("같은 조건이 있으면 그 검색을 열고 알려 준다", async () => {
    await site.saveSearch(ALICE, { ...naktji, name: "먼저 것" });
    const body = await (await savedModal(env, interaction(naktji), "savem", "", { name: "새것", target: "" })).run();
    assert.match(body.content, /"먼저 것" 이름으로 이미 저장돼 있습니다/);
  });

  it("고치는 중이면 그 검색을 고친다", async () => {
    await site.saveSearch(ALICE, { ...naktji, name: "낙지" });
    const changed = { ...naktji, exact: false };
    const body = await (await savedModal(env, interaction(changed, 1), "savem", "1", { name: "낙지 넓게", target: "" })).run();
    assert.deepEqual(site.calls.at(-2)[2], { id: 1, ...changed, name: "낙지 넓게", targetPrice: 0 });
    assert.equal(body.content, "고쳤습니다.");
  });

  it("목표가가 숫자가 아니면 거절한다", async () => {
    const answer = await savedModal(env, interaction(naktji), "savem", "", { name: "낙지", target: "사천" });
    assert.match(answer.body.data.content, /숫자로/);
  });
});

describe("고치기와 지우기", () => {
  beforeEach(async () => {
    await site.saveSearch(ALICE, { ...naktji, name: "낙지", targetPrice: 4300 });
  });

  it("이름·목표가는 지금 값을 채운 입력창을 열고 제출하면 고친다", async () => {
    const opened = await savedComponent(env, interaction(), "meta", "1", []);
    assert.equal(opened.body.data.custom_id, "f:metam:1");
    assert.deepEqual(opened.body.data.components.map((line) => line.components[0].value), ["낙지", "4300"]);

    await (await savedModal(env, interaction(), "metam", "1", { name: "새 이름", target: "5000" })).run();
    assert.deepEqual(site.calls.find((c) => c[0] === "saveSearch" && c[2].id === 1)[2], { id: 1, ...naktji, name: "새 이름", targetPrice: 5000 });
  });

  it("조건 고치기는 저장한 조건과 번호로 검색 화면을 연다", async () => {
    const body = await (await savedComponent(env, interaction(), "edit", "1", [])).run();
    assert.match(body.embeds[0].url, /sid=1/);
    assert.equal(body.embeds[0].title, "낙지 고치는 중");
    assert.equal(find(body, "q:save").label, "저장 검색 고치기");
  });

  it("목표가 끄기는 목표가를 지우고 상세를 다시 보여 준다", async () => {
    const body = await (await savedComponent(env, interaction(), "off", "1", [])).run();
    assert.equal(site.searches[0].targetPrice, null);
    assert.equal(body.content, "목표가를 껐습니다.");
  });

  it("삭제는 한 번 더 묻고 확인하면 지운 뒤 목록으로 간다", async () => {
    const ask = await savedComponent(env, interaction(), "del", "1", []);
    assert.deepEqual(ids(ask.body.data), ["f:delok:1", "f:show:1"]);
    assert.deepEqual(ask.body.data.embeds, []);

    const done = await savedComponent(env, interaction(), "delok", "1", []);
    assert.equal(site.searches.length, 0);
    assert.match((await done.run()).embeds[0].description, /저장한 검색이 없습니다/);
  });

  it("없는 검색은 찾지 못했다고 알린다", async () => {
    for (const act of ["meta", "off", "del", "edit"]) {
      const answer = await savedComponent(env, interaction(), act, "99", []);
      assert.match(answer.body.data.content, /찾지 못했습니다/);
    }
  });
});

describe("사이트에서 가져오기", () => {
  it("연결하지 않았으면 연결 코드 받기를 안내한다", async () => {
    site.linked = false;
    const answer = await savedComponent(env, interaction(), "imp", "", []);
    assert.equal(answer.body.type, 4);
    assert.ok(find(answer.body.data, "me:link"));
  });

  it("가져온 결과를 줄마다 보여 주고 해당 없는 줄은 뺀다", async () => {
    site.importResult = { added: ["스매시 검", "천옷 전체"], existing: 1, invalid: 0, full: 2 };
    const body = await (await savedComponent(env, interaction(), "imp", "", [])).run();
    assert.match(body.content, /사이트 즐겨찾기 2개를 가져왔습니다/);
    assert.match(body.content, /• 스매시 검\n• 천옷 전체/);
    assert.match(body.content, /이미 있는 검색 1개/);
    assert.match(body.content, /가득 차 2개/);
    assert.doesNotMatch(body.content, /조건이 빈/);
  });

  it("동의하지 않았으면 동의 화면으로 간다", async () => {
    site.registered = false;
    const answer = await savedComponent(env, interaction(), "imp", "", []);
    assert.match(answer.body.data.content, /동의가 필요합니다/);
  });
});

describe("새 검색", () => {
  it("빈 검색 화면을 연다", async () => {
    const body = await (await savedComponent(env, interaction(), "new", "", [])).run();
    assert.match(body.embeds[0].description, /검색어나 분류를 정하면/);
    assert.ok(find(body, "q:kw"));
  });
});
