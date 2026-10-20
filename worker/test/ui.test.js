import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { COMMANDS, CONSENT_VERSION } from "../src/commands.js";
import { stateUrl } from "../src/search.js";
import { ALICE, ENTRIES, click, componentsOf, fakeSite, find, ids, run, slash, submit, typing } from "./helpers.js";

const MENU_BUTTONS = ["m:search", "m:fav", "m:ab", "m:erin", "m:set", "m:me"];
const EMPTY = { keyword: "", category: "", filterKey: "", exact: false };
const card = (query, sid) => [{ url: stateUrl(query, sid) }];
let site;

beforeEach(() => {
  site = fakeSite();
});

const register = () => site.registerUser(ALICE, CONSENT_VERSION);

describe("명령 정의", () => {
  it("/마비쿠마 하나뿐이고 아이템은 바로 검색하는 선택 입력이다", () => {
    assert.equal(COMMANDS.length, 1);
    assert.equal(COMMANDS[0].name, "마비쿠마");
    assert.deepEqual(
      COMMANDS[0].options.map((o) => [o.name, o.autocomplete, o.required ?? false]),
      [["아이템", true, false]],
    );
    assert.match(COMMANDS[0].options[0].description, /바로 검색/);
  });
});

describe("메뉴", () => {
  it("/마비쿠마 는 본인에게만 보이는 메뉴를 연다", async () => {
    const { initial, view } = await run(site, slash());
    assert.equal(initial.type, 4);
    assert.equal(view.flags, 64);
    assert.deepEqual(ids(view).slice(0, 6), MENU_BUTTONS);
    assert.equal(find(view, "m:search").label, "경매장 검색");
    assert.match(componentsOf(view).at(-1).url, /ref=bot/);
  });

  it("동의한 사용자에게는 저장한 검색 수와 상태를 보여 준다", async () => {
    await register();
    await site.saveSearch(ALICE, { ...EMPTY, keyword: "낙지", name: "낙지" });
    await site.changeArbeitSubs(ALICE, { add: ["entry-1"] });
    assert.match((await run(site, slash())).view.content, /즐겨찾기 1개 · 아르바이트 1개 · 알림 켜짐/);
  });

  it("경매장 검색은 처리 중으로 답한 뒤 빈 검색 화면으로 바꾼다", async () => {
    const result = await run(site, click("m:search"));
    assert.equal(result.initial.type, 6);
    assert.equal(result.edit.content, "");
    assert.match(result.edit.embeds[0].description, /검색어나 분류를 정하면/);
    assert.ok(find(result.edit, "q:kw"));
  });

  it("모르는 단추와 입력창은 다시 열라고 안내한다", async () => {
    assert.match((await run(site, click("zz:what"))).view.content, /만료된 단추/);
    assert.match((await run(site, click("q:nothing", undefined, ALICE, card(EMPTY)))).view.content, /만료된 단추/);
    assert.match((await run(site, submit("zz:what", {}))).view.content, /만료된 입력창/);
  });
});

describe("바로 검색", () => {
  it("/마비쿠마 아이템:낙지 는 자동완성 이름이면 정확히 일치로 검색한다", async () => {
    site.items = ["낙지", "낙지 구이"];
    const result = await run(site, slash({ 아이템: "낙지" }));
    assert.equal(result.initial.type, 5);
    assert.equal(result.initial.data.flags, 64);
    assert.deepEqual(site.calls.find((c) => c[0] === "searchAuction")[1], { ...EMPTY, keyword: "낙지", exact: true });
    assert.match(result.edit.embeds[0].url, /exact=1/);
  });

  it("목록에 없는 이름은 부분 일치로 검색한다", async () => {
    await run(site, slash({ 아이템: "낙" }));
    assert.deepEqual(site.calls.find((c) => c[0] === "searchAuction")[1], { ...EMPTY, keyword: "낙", exact: false });
  });

  it("입력 중 자동완성은 이름 후보를 준다", async () => {
    site.items = ["낙지", "낙지 구이", "마나 허브"];
    const reply = await run(site, typing("낙"));
    assert.deepEqual(reply.initial.data.choices.map((c) => c.value), ["낙지", "낙지 구이"]);
  });
});

describe("검색 화면 연결", () => {
  it("검색어 단추와 입력창 제출이 검색 화면으로 이어진다", async () => {
    const opened = await run(site, click("q:kw", undefined, ALICE, card(EMPTY)));
    assert.equal(opened.initial.type, 9);

    const searched = await run(site, submit("q:kwm", { keyword: "낙지" }, ALICE, card(EMPTY)));
    assert.equal(searched.initial.type, 6);
    assert.match(searched.edit.embeds[0].url, /keyword=/);
  });

  it("상세 조건 직접 입력 창과 제출이 연결된다", async () => {
    const query = { ...EMPTY, category: "검" };
    const opened = await run(site, click("k:man:number|공격|", undefined, ALICE, card(query)));
    assert.equal(opened.view.custom_id, "k:mm:number|공격|");
    await run(site, submit("k:mm:number|공격|", { min: "30" }, ALICE, card(query)));
    assert.deepEqual(site.calls.find((c) => c[0] === "addSearchCondition")[2], {
      kind: "number",
      optionType: "공격",
      min: 30,
    });
  });

  it("즐겨찾기에 저장은 동의가 없으면 동의 화면을, 있으면 입력창을 열고 저장한다", async () => {
    const query = { ...EMPTY, keyword: "낙지" };
    const asked = await run(site, click("q:save", undefined, ALICE, card(query)));
    assert.match(asked.view.content, /동의가 필요합니다/);

    await register();
    const opened = await run(site, click("q:save", undefined, ALICE, card(query)));
    assert.equal(opened.view.custom_id, "f:savem");

    const saved = await run(site, submit("f:savem", { name: "낙지", target: "4300" }, ALICE, card(query)));
    assert.equal(saved.edit.content, "즐겨찾기에 저장했습니다.");
    assert.equal(saved.edit.embeds[0].title, "낙지");
  });

  it("사이트가 이유를 알려 주는 오류는 그대로 보여 준다", async () => {
    await register();
    const result = await run(site, submit("f:savem", { name: "너무많음", target: "" }, ALICE, card({ ...EMPTY, keyword: "낙지" })));
    assert.match(result.edit.content, /20개까지/);
  });
});

describe("동의", () => {
  it("개인 기능은 동의 화면을 거쳐 가려던 화면으로 이어진다", async () => {
    for (const [button, target] of [
      ["m:fav", "fav"],
      ["m:ab", "ab"],
      ["m:set", "set"],
      ["m:me", "me"],
    ]) {
      const asked = await run(site, click(button));
      assert.match(asked.view.content, /동의가 필요합니다/);
      assert.match(asked.view.content, /저장한 검색과 목표 가격/);
      assert.ok(find(asked.view, `c:ok:${target}`));
    }
    assert.equal(site.users.size, 0);

    const agreed = await run(site, click("c:ok:fav"));
    assert.deepEqual(site.calls.find((c) => c[0] === "registerUser"), ["registerUser", ALICE, CONSENT_VERSION]);
    assert.equal(agreed.initial.type, 6);
    assert.equal(agreed.edit.embeds[0].title, "내 즐겨찾기");
  });

  it("알 수 없는 동의 대상은 메뉴로 돌려보내고 등록하지 않는다", async () => {
    const result = await run(site, click("c:ok:evil"));
    assert.deepEqual(ids(result.view).slice(0, 6), MENU_BUTTONS);
    assert.equal(site.users.size, 0);
  });

  it("검색과 에린 시계는 동의 없이 쓸 수 있다", async () => {
    assert.match((await run(site, click("m:erin"))).view.content, /에린 시각/);
    const searched = await run(site, click("q:refresh", undefined, ALICE, card({ ...EMPTY, keyword: "낙지" })));
    assert.equal(searched.edit.embeds.length, 1);
  });
});

describe("에린 시계", () => {
  it("에린 시각을 보여 주고 공유하면 모두에게 보인다", async () => {
    const { view } = await run(site, click("m:erin"));
    assert.deepEqual(ids(view), ["e:r", "e:share", "m:menu"]);
    const shared = await run(site, click("e:share"));
    assert.equal(shared.view.flags, undefined);
  });
});

describe("아르바이트 알림", () => {
  beforeEach(register);

  it("메뉴에서 고른 항목은 켜고 해제한 항목은 끈다", async () => {
    await site.changeArbeitSubs(ALICE, { add: ["entry-1", "entry-17"] });
    const view = (await run(site, click("m:ab"))).view;
    assert.equal(find(view, "a:0").options.length, 15);

    await run(site, click("a:0", ["entry-2"]));
    assert.deepEqual(site.users.get(ALICE).arbeit, ["entry-2", "entry-17"]);
    assert.match((await run(site, click("a:all"))).view.content, new RegExp(`\\(${ENTRIES.length}개\\)`));
  });
});

describe("알림 설정", () => {
  beforeEach(register);

  it("단추와 목록, 직접 입력으로 바꾼다", async () => {
    await run(site, click("s:digest"));
    assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { digest: false }]);
    await run(site, click("s:quiet", ["23-7"]));
    assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { quiet: { start: 23, end: 7 } }]);
    assert.match((await run(site, submit("s:custom", { start: "4", end: "4" }))).view.content, /같으면/);
  });
});

describe("내 정보와 사이트 연결", () => {
  beforeEach(async () => {
    await register();
    await site.saveSearch(ALICE, { ...EMPTY, keyword: "낙지", name: "낙지" });
  });

  it("저장한 검색 수와 연결 상태를 보여 주고 삭제는 한 번 더 묻는다", async () => {
    const { view } = await run(site, click("m:me"));
    assert.match(view.content, /즐겨찾기 1개 · 아르바이트 0개/);
    assert.match(view.content, /사이트 계정 연결 안 됨/);

    assert.deepEqual(ids((await run(site, click("me:ask"))).view), ["me:del", "me:cancel"]);
    const done = await run(site, click("me:del"));
    assert.match(done.view.content, /삭제했습니다/);
    assert.equal(site.searches.has(ALICE), false);
  });

  it("연결 코드를 받고 연결을 해제한다", async () => {
    const code = await run(site, click("me:link"));
    assert.match(code.view.content, /`ABCD-EFGH`/);
    site.linked = true;
    assert.match((await run(site, click("me:unlink"))).view.content, /사이트 계정 연결 안 됨/);
  });

  it("사이트에서 가져오기는 연결이 없으면 안내하고 있으면 결과를 보여 준다", async () => {
    assert.ok(find((await run(site, click("f:imp"))).view, "me:link"));
    site.linked = true;
    site.importResult = { added: ["스매시 검"], existing: 0, invalid: 0, full: 0 };
    assert.match((await run(site, click("f:imp"))).edit.content, /사이트 즐겨찾기 1개를 가져왔습니다/);
  });
});

describe("오류", () => {
  it("사이트 Worker 가 실패하면 일반 안내로 답한다", async () => {
    site.fail = new Error("down");
    const result = await run(site, click("m:fav"));
    assert.match(result.view.content, /처리하지 못했습니다/);
  });

  it("처리 중으로 답한 뒤 실패하면 원래 메시지를 안내 문구로 바꾸되 이유가 있으면 보여 준다", async () => {
    const query = card({ ...EMPTY, keyword: "낙지" });
    site.searchError = new Error("db exploded");
    assert.match((await run(site, click("q:refresh", undefined, ALICE, query))).edit.content, /처리하지 못했습니다/);
    site.searchError = new Error("경매장을 읽지 못했습니다. (HTTP 500)");
    assert.match((await run(site, click("q:refresh", undefined, ALICE, query))).edit.content, /HTTP 500/);
  });

  it("자동완성은 실패해도 빈 목록을 준다", async () => {
    site.searchItems = async () => {
      throw new Error("down");
    };
    assert.deepEqual((await run(site, typing("낙"))).initial.data.choices, []);
  });
});
