import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { COMMANDS, CONSENT_VERSION } from "../src/commands.js";
import { ALICE, click, componentsOf, fakeSite, find, ids, run, slash, submit, textOf, typing } from "./helpers.js";

const MENU_BUTTONS = ["m:price", "m:fav", "m:ab", "m:erin", "m:set", "m:me"];
const EMPTY = { keyword: "", category: "", filterKey: "", exact: false };
let site;

beforeEach(() => {
  site = fakeSite();
});

const register = () => site.registerUser(ALICE, CONSENT_VERSION);

describe("명령 정의", () => {
  it("/마비쿠마 하나뿐이고 아이템은 바로 시세를 보는 선택 입력이다", () => {
    assert.equal(COMMANDS.length, 1);
    assert.equal(COMMANDS[0].name, "마비쿠마");
    assert.deepEqual(
      COMMANDS[0].options.map((o) => [o.name, o.autocomplete, o.required ?? false]),
      [["아이템", true, false]],
    );
    assert.match(COMMANDS[0].options[0].description, /바로 시세/);
  });

  it("서버에 들이지 않고 사용자 계정에 설치해도 DM 과 어디서든 쓸 수 있다", () => {
    assert.deepEqual(COMMANDS[0].integration_types, [0, 1]);
    assert.deepEqual(COMMANDS[0].contexts, [0, 1, 2]);
  });

  it("DM 에서 온 상호작용(user 만 있음)도 사용자로 알아본다", async () => {
    const dm = { type: 2, token: "t", user: { id: ALICE }, data: { name: "마비쿠마", options: [] } };
    const { initial } = await run(site, dm);
    assert.equal(initial.type, 4);
    assert.ok(find(initial.data, "m:price"));
  });
});

describe("메뉴", () => {
  it("/마비쿠마 는 본인에게만 보이는 메뉴를 연다", async () => {
    const { initial, view } = await run(site, slash());
    assert.equal(initial.type, 4);
    assert.equal(view.flags, 64);
    assert.deepEqual(ids(view).slice(0, 6), MENU_BUTTONS);
    assert.equal(find(view, "m:price").label, "시세 보기");
    assert.equal(find(view, "m:fav").label, "즐겨찾기 알림");
    assert.match(componentsOf(view).at(-1).url, /ref=bot/);
  });

  it("동의한 사용자에게는 저장한 검색 수와 상태를 보여 준다", async () => {
    await register();
    await site.saveSearch(ALICE, { ...EMPTY, keyword: "낙지", name: "낙지" });
    await site.changeArbeitSubs(ALICE, { add: ["entry-1"] });
    assert.match((await run(site, slash())).view.content, /즐겨찾기 1개 · 아르바이트 1개 · 알림 켜짐/);
  });

  it("모르는 단추와 입력창은 다시 열라고 안내한다", async () => {
    assert.match((await run(site, click("zz:what"))).view.content, /만료된 단추/);
    assert.match((await run(site, click("q:nothing"))).view.content, /만료된 단추/);
    assert.match((await run(site, submit("zz:what", {}))).view.content, /만료된 입력창/);
    assert.match((await run(site, submit("q:kwm", { keyword: "낙지" }))).view.content, /만료된 입력창/);
  });

  it("입력 중 자동완성은 이름 후보를 준다", async () => {
    site.items = ["낙지", "낙지 구이", "마나 허브"];
    const reply = await run(site, typing("낙"));
    assert.deepEqual(reply.initial.data.choices.map((c) => c.value), ["낙지", "낙지 구이"]);
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
      assert.match(asked.view.content, /즐겨찾기 알림에 등록한 검색/);
      assert.ok(find(asked.view, `c:ok:${target}`));
    }
    assert.equal(site.users.size, 0);

    const agreed = await run(site, click("c:ok:fav"));
    assert.deepEqual(site.calls.find((c) => c[0] === "registerUser"), ["registerUser", ALICE, CONSENT_VERSION]);
    assert.equal(agreed.initial.type, 6);
    assert.match(agreed.edit.content, /즐겨찾기 알림/);
  });

  it("알 수 없는 동의 대상은 메뉴로 돌려보내고 등록하지 않는다", async () => {
    const result = await run(site, click("c:ok:evil"));
    assert.deepEqual(ids(result.view).slice(0, 6), MENU_BUTTONS);
    assert.equal(site.users.size, 0);
  });

  it("시세 보기와 에린 시계는 동의 없이 쓸 수 있다", async () => {
    assert.match((await run(site, click("m:erin"))).view.content, /에린 시각/);
    assert.equal((await run(site, click("m:price"))).view.custom_id, "p:m");
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

  const V2 = 1 << 15;
  const fromArbeit = (customId, values) => ({ ...click(customId, values), message: { flags: V2 | 64 } });

  it("새 형식 메시지로 열고 한 쪽에 묶음 12개를 묶음마다 칸 하나로 보여 준다", async () => {
    await site.changeArbeitSubs(ALICE, { add: ["entry-1", "entry-20"] });
    const { initial, view } = await run(site, click("m:ab"));
    assert.equal(initial.type, 4);
    assert.equal(view.flags, V2 | 64);
    assert.equal(view.content, undefined);
    assert.equal(view.embeds, undefined);
    assert.match(textOf(view), /아르바이트 알림\*\* 2개 묶음 켜짐/);

    const menus = componentsOf(view).filter((each) => each.type === 3);
    assert.equal(menus.length, 12);
    assert.deepEqual(menus[0].options.map((o) => [o.value, o.default ?? false]), [
      ["entry-0", false],
      ["entry-1", true],
      ["off", false],
    ]);
    assert.equal(menus[0].options[0].description, "모집 7~19시, 보고 9시부터");
    assert.equal(menus[0].max_values, 1);
    assert.equal(menus[3].placeholder, "묶음3: 알림 끔");
    assert.equal(menus[3].options[0].description, "보고 15시부터");
    assert.deepEqual(ids(view).slice(-5), ["a:p:-1", "a:pg", "a:p:1", "a:none:0", "m:menu"]);
    assert.equal(find(view, "a:p:-1").disabled, true);

    const total = (view.components ?? []).reduce((n, each) => n + 1 + (each.components?.length ?? 0), 0);
    assert.ok(total <= 40, `구성요소 ${total}개`);
  });

  it("묶음에서는 하나만 켜지고 알림 끄기는 그 묶음만 끈다", async () => {
    await site.changeArbeitSubs(ALICE, { add: ["entry-0", "entry-1", "entry-20"] });
    const picked = await run(site, fromArbeit("a:g:0", ["entry-1"]));
    assert.equal(picked.initial.type, 7);
    assert.deepEqual(site.users.get(ALICE).arbeit, ["entry-1", "entry-20"]);

    await run(site, fromArbeit("a:g:0", ["off"]));
    assert.deepEqual(site.users.get(ALICE).arbeit, ["entry-20"]);

    const second = await run(site, fromArbeit("a:g:18", ["entry-21"]));
    assert.deepEqual(site.users.get(ALICE).arbeit, ["entry-20", "entry-21"]);
    assert.ok(find(second.view, "a:g:18"));
    assert.equal(find(second.view, "a:p:2").disabled, true);
  });

  it("쪽을 넘기고 전체 끄기를 하고 메뉴는 새 메시지로 연다", async () => {
    await site.changeArbeitSubs(ALICE, { add: ["entry-3", "entry-25"] });
    const next = await run(site, fromArbeit("a:p:1"));
    assert.equal(componentsOf(next.view).filter((each) => each.type === 3).length, 11);
    assert.equal(find(next.view, "a:pg").label, "2/2");

    const cleared = await run(site, fromArbeit("a:none:1"));
    assert.deepEqual(site.users.get(ALICE).arbeit, []);
    assert.ok(find(cleared.view, "a:none:1"));

    const menu = await run(site, fromArbeit("m:menu"));
    assert.equal(menu.initial.type, 4);
    assert.equal(menu.view.flags, 64);
    assert.deepEqual(ids(menu.view).slice(0, 6), MENU_BUTTONS);
  });

  it("예전 메시지의 단추는 만료로 안내한다", async () => {
    assert.match((await run(site, click("a:0", ["entry-2"]))).view.content, /만료된 단추/);
    assert.match((await run(site, click("a:all"))).view.content, /만료된 단추/);
    assert.match((await run(site, fromArbeit("a:g:99", ["entry-2"]))).view.content, /만료된 단추/);
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
});

describe("오류", () => {
  it("사이트 Worker 가 실패하면 일반 안내로 답한다", async () => {
    site.fail = new Error("down");
    const result = await run(site, click("m:fav"));
    assert.match(result.view.content, /처리하지 못했습니다/);
  });

  it("처리 중으로 답한 뒤 실패하면 원래 메시지를 안내 문구로 바꾸되 이유가 있으면 보여 준다", async () => {
    site.priceCard = async () => {
      throw new Error("db exploded");
    };
    assert.match((await run(site, click("p:r:candle:낙지"))).edit.content, /처리하지 못했습니다/);
    site.priceCard = async () => {
      throw new Error("경매장을 읽지 못했습니다. (HTTP 500)");
    };
    assert.match((await run(site, click("p:r:candle:낙지"))).edit.content, /HTTP 500/);
  });

  it("자동완성은 실패해도 빈 목록을 준다", async () => {
    site.searchItems = async () => {
      throw new Error("down");
    };
    assert.deepEqual((await run(site, typing("낙"))).initial.data.choices, []);
  });
});
