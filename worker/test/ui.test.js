import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { COMMANDS, CONSENT_VERSION } from "../src/commands.js";
import {
  ALICE,
  ENTRIES,
  click,
  componentsOf,
  fakeSite,
  find,
  ids,
  run,
  slash,
  submit,
  summary,
  typing,
} from "./helpers.js";

const MENU_BUTTONS = ["m:price", "m:fav", "m:ab", "m:erin", "m:set", "m:me"];
let site;

beforeEach(() => {
  site = fakeSite();
});

const register = () => site.registerUser(ALICE, CONSENT_VERSION);
const text = (result) => (result.edit ?? result.view).content;

describe("명령 정의", () => {
  it("/마비쿠마 하나뿐이고 아이템은 선택 입력이다", () => {
    assert.equal(COMMANDS.length, 1);
    assert.equal(COMMANDS[0].name, "마비쿠마");
    assert.deepEqual(COMMANDS[0].options.map((o) => [o.name, o.autocomplete, o.required ?? false]), [["아이템", true, false]]);
  });
});

describe("메뉴", () => {
  it("/마비쿠마 는 본인에게만 보이는 메뉴를 연다", async () => {
    const { initial, view } = await run(site, slash());

    assert.equal(initial.type, 4);
    assert.equal(view.flags, 64);
    assert.match(view.content, /\*\*마비쿠마\*\*/);
    assert.deepEqual(ids(view).slice(0, 6), MENU_BUTTONS);
    assert.equal(componentsOf(view).at(-1).style, 5);
    assert.match(componentsOf(view).at(-1).url, /ref=bot/);
    assert.doesNotMatch(view.content, /즐겨찾기 \d/);
  });

  it("동의한 사용자에게는 지금 상태를 한 줄로 보여 준다", async () => {
    await register();
    await site.addFavorite(ALICE, "낙지", 4300);
    await site.changeArbeitSubs(ALICE, { add: ["entry-1", "entry-2"] });

    const { view } = await run(site, slash());
    assert.match(view.content, /즐겨찾기 1개 · 아르바이트 2개 · 알림 켜짐/);

    await site.updateSettings(ALICE, { paused: true });
    assert.match((await run(site, click("m:menu"))).view.content, /알림 일시정지/);
  });

  it("← 메뉴 단추는 같은 메시지를 메뉴로 되돌린다", async () => {
    const { initial, view } = await run(site, click("m:menu"));
    assert.equal(initial.type, 7);
    assert.deepEqual(ids(view).slice(0, 6), MENU_BUTTONS);
  });

  it("모르는 단추는 다시 열라고 안내한다", async () => {
    assert.match((await run(site, click("zz:what"))).view.content, /만료된 단추/);
    assert.match((await run(site, submit("zz:what", {}))).view.content, /만료된 입력창/);
  });
});

describe("에린 시계", () => {
  it("에린 시각을 보여 주고 새로고침과 공유가 있다", async () => {
    const { initial, view } = await run(site, click("m:erin"));
    assert.equal(initial.type, 7);
    assert.match(view.content, /에린 시각 \*\*\d{2}:\d{2}\*\* \((낮|밤)\)/);
    assert.deepEqual(ids(view), ["e:r", "e:share", "m:menu"]);
  });

  it("공유하면 모두에게 보이는 새 메시지가 된다", async () => {
    const { initial, view } = await run(site, click("e:share"));
    assert.equal(initial.type, 4);
    assert.equal(view.flags, undefined);
    assert.match(view.content, /다음 상점 교체까지/);
  });
});

describe("시세 조회", () => {
  beforeEach(() => {
    site.items = ["낙지", "낙지 구이", "마나 허브"];
    site.summaries = { 낙지: summary("낙지"), "마나 허브": summary("마나 허브") };
  });

  it("시세 단추는 이름 입력창을 연다", async () => {
    const { initial, view } = await run(site, click("m:price"));
    assert.equal(initial.type, 9);
    assert.equal(view.custom_id, "p:q");
    assert.equal(view.components[0].components[0].custom_id, "name");
  });

  it("이름이 정확히 맞으면 처리 중으로 답한 뒤 시세와 단추로 바꾼다", async () => {
    const result = await run(site, submit("p:q", { name: "낙지" }));

    assert.equal(result.initial.type, 6);
    assert.match(result.edit.content, /현재 최저가 \*\*4,290\*\*/);
    assert.deepEqual(ids(result.edit), ["p:share:낙지", "p:fav:낙지", "p:r:낙지", "m:menu", "https://mabi.spkuma.com/item/낙지?ref=bot", "https://mabi.spkuma.com/auction?keyword=낙지&exact=1&ref=bot", "m:price"]);
    assert.match(result.edits.at(-1).url, /webhooks\/app\/interaction-token\/messages\/@original$/);
  });

  it("앞부분이 하나로 좁혀지면 그 아이템을 보여 준다", async () => {
    const result = await run(site, submit("p:q", { name: "마나" }));
    assert.match(result.edit.content, /\*\*마나 허브\*\*/);
  });

  it("앞부분이 여럿에 맞으면 고르게 하고, 고르면 시세를 보여 준다", async () => {
    const ask = await run(site, submit("p:q", { name: "낙" }));
    assert.equal(ask.initial.type, 7);
    assert.match(ask.view.content, /2개입니다/);
    assert.deepEqual(find(ask.view, "p:pick").options.map((o) => o.value), ["낙지", "낙지 구이"]);

    const picked = await run(site, click("p:pick", ["낙지"]));
    assert.equal(picked.initial.type, 6);
    assert.match(picked.edit.content, /\*\*낙지\*\*/);
  });

  it("아무것도 맞지 않으면 다시 입력하게 한다", async () => {
    const result = await run(site, submit("p:q", { name: "없는것" }));
    assert.match(result.view.content, /맞는 아이템이 없습니다/);
    assert.deepEqual(ids(result.view), ["m:price", "m:menu"]);
  });

  it("기록이 없는 이름은 안내만 한다", async () => {
    const result = await run(site, click("p:r:낙지 구이"));
    assert.match(result.edit.content, /거래 기록이 없습니다/);
  });

  it("공유는 모두에게 보이는 새 메시지로 시세와 링크만 올린다", async () => {
    const result = await run(site, click("p:share:낙지"));

    assert.equal(result.initial.type, 5);
    assert.equal(result.initial.data, undefined);
    assert.deepEqual(ids(result.edit), ["https://mabi.spkuma.com/item/낙지?ref=bot", "https://mabi.spkuma.com/auction?keyword=낙지&exact=1&ref=bot"]);
  });

  it("/마비쿠마 아이템:낙지 는 메뉴 없이 바로 시세 화면을 본인에게 보여 준다", async () => {
    const result = await run(site, slash({ 아이템: "낙지" }));

    assert.equal(result.initial.type, 5);
    assert.equal(result.initial.data.flags, 64);
    assert.match(result.edit.content, /\*\*낙지\*\*/);
    assert.ok(find(result.edit, "p:share:낙지"));

    const many = await run(site, slash({ 아이템: "낙" }));
    assert.ok(find(many.edit, "p:pick"));
  });

  it("즐겨찾기에 추가는 동의가 없으면 동의 화면을 먼저 보여 준다", async () => {
    const asked = await run(site, click("p:fav:낙지"));
    assert.equal(asked.initial.type, 4);
    assert.match(asked.view.content, /동의가 필요합니다/);
    assert.equal(site.favorites.size, 0);

    await register();
    const added = await run(site, click("p:fav:낙지"));
    assert.match(added.view.content, /즐겨찾기에 더했습니다/);
    assert.ok(find(added.view, "m:fav"));
    assert.deepEqual(site.favorites.get(ALICE), [{ name: "낙지", targetPrice: null }]);
  });

  it("입력 중 자동완성은 이름 후보를 준다", async () => {
    const reply = await run(site, typing("낙"));
    assert.equal(reply.initial.type, 8);
    assert.deepEqual(reply.initial.data.choices.map((c) => c.value), ["낙지", "낙지 구이"]);
  });
});

describe("동의", () => {
  it("개인 기능은 동의 화면을 거쳐 가려던 화면으로 이어진다", async () => {
    for (const [button, target] of [["m:fav", "fav"], ["m:ab", "ab"], ["m:set", "set"], ["m:me", "me"]]) {
      const asked = await run(site, click(button));
      assert.match(asked.view.content, /동의가 필요합니다/);
      assert.ok(find(asked.view, `c:ok:${target}`));
    }
    assert.equal(site.users.size, 0);

    const agreed = await run(site, click("c:ok:ab"));
    assert.deepEqual(site.calls.find((c) => c[0] === "registerUser"), ["registerUser", ALICE, CONSENT_VERSION]);
    assert.match(agreed.view.content, /\*\*아르바이트 알림\*\*/);
  });

  it("동의 뒤 즐겨찾기로 이어지면 처리 중으로 답한 뒤 목록을 채운다", async () => {
    const agreed = await run(site, click("c:ok:fav"));
    assert.equal(agreed.initial.type, 6);
    assert.match(agreed.edit.content, /즐겨찾기가 없습니다/);
  });

  it("알 수 없는 동의 대상은 메뉴로 돌려보내고 등록하지 않는다", async () => {
    const result = await run(site, click("c:ok:evil"));
    assert.deepEqual(ids(result.view).slice(0, 6), MENU_BUTTONS);
    assert.equal(site.users.size, 0);
  });

  it("시세와 에린은 동의 없이 쓸 수 있다", async () => {
    site.summaries = { 낙지: summary("낙지") };
    assert.match((await run(site, click("m:erin"))).view.content, /에린 시각/);
    assert.match((await run(site, click("p:r:낙지"))).edit.content, /낙지/);
  });
});

describe("즐겨찾기", () => {
  beforeEach(async () => {
    await register();
    site.items = ["낙지", "낙지 구이", "마나 허브"];
    site.summaries = { 낙지: summary("낙지"), 마나허브: summary("마나허브") };
  });

  it("비어 있으면 선택 메뉴 없이 추가 단추만 있다", async () => {
    const result = await run(site, click("m:fav"));
    assert.equal(result.initial.type, 6);
    assert.match(result.edit.content, /즐겨찾기가 없습니다/);
    assert.deepEqual(ids(result.edit), ["f:add", "m:fav", "m:menu"]);
  });

  it("목록은 선택 메뉴로 항목을 고르게 한다", async () => {
    await site.addFavorite(ALICE, "낙지", 4300);
    await site.addFavorite(ALICE, "마나 허브", null);
    const result = await run(site, click("m:fav"));

    assert.match(result.edit.content, /\*\*내 즐겨찾기\*\* \(2개\)/);
    const menu = find(result.edit, "f:open");
    assert.deepEqual(menu.options.map((o) => [o.value, o.description]), [["낙지", "목표 4,300"], ["마나 허브", "목표가 없음"]]);
  });

  it("추가 단추는 이름과 목표가 입력창을 연다", async () => {
    const { initial, view } = await run(site, click("f:add"));
    assert.equal(initial.type, 9);
    assert.deepEqual(view.components.map((r) => [r.components[0].custom_id, r.components[0].required]), [["name", true], ["target", false]]);
  });

  it("이름과 목표가로 추가하면 그 아이템 화면을 보여 준다", async () => {
    const result = await run(site, submit("f:add", { name: "낙지", target: "4,300" }));

    assert.deepEqual(site.calls.find((c) => c[0] === "addFavorite"), ["addFavorite", ALICE, "낙지", 4300]);
    assert.equal(result.initial.type, 6);
    assert.match(result.edit.content, /목표 \*\*4,300\*\* · 지금 목표 이하입니다/);
    assert.deepEqual(ids(result.edit).slice(0, 4), ["f:t:낙지", "f:off:낙지", "f:del:낙지", "f:list"]);
  });

  it("목표가를 비우면 목표 없이 추가하고 숫자가 아니면 거절한다", async () => {
    await run(site, submit("f:add", { name: "낙지", target: "" }));
    assert.deepEqual(site.calls.find((c) => c[0] === "addFavorite"), ["addFavorite", ALICE, "낙지", undefined]);

    const bad = await run(site, submit("f:add", { name: "낙지", target: "사천" }));
    assert.match(bad.view.content, /숫자로/);
  });

  it("이름이 여럿에 맞으면 고르게 하고 고른 아이템에 목표가를 이어 붙인다", async () => {
    const ask = await run(site, submit("f:add", { name: "낙", target: "4000" }));
    assert.deepEqual(find(ask.view, "f:pa:4000").options.map((o) => o.value), ["낙지", "낙지 구이"]);

    const picked = await run(site, click("f:pa:4000", ["낙지"]));
    assert.deepEqual(site.calls.find((c) => c[0] === "addFavorite"), ["addFavorite", ALICE, "낙지", 4000]);
    assert.match(picked.edit.content, /\*\*낙지\*\*/);

    const none = await run(site, click("f:pa:-", ["낙지"]));
    assert.deepEqual(site.calls.filter((c) => c[0] === "addFavorite").at(-1), ["addFavorite", ALICE, "낙지", undefined]);
    assert.ok(none.edit);
  });

  it("사이트가 한도 같은 이유를 알려 주면 그대로 보여 준다", async () => {
    site.items.push("너무많음");
    const result = await run(site, submit("f:add", { name: "너무많음", target: "" }));
    assert.match(result.view.content, /20개까지/);
  });

  it("항목을 고르면 상세 화면이 열리고 목표가를 바꾸거나 끄거나 삭제한다", async () => {
    await site.addFavorite(ALICE, "낙지", 4000);

    const detail = await run(site, click("f:open", ["낙지"]));
    assert.match(detail.edit.content, /아직 목표보다 비쌉니다|지금 목표 이하입니다/);
    assert.equal(find(detail.edit, "f:t:낙지").label, "목표가 바꾸기");

    const modal = await run(site, click("f:t:낙지"));
    assert.equal(modal.view.custom_id, "f:t:낙지");

    const changed = await run(site, submit("f:t:낙지", { target: "5000" }));
    assert.deepEqual(site.calls.filter((c) => c[0] === "addFavorite").at(-1), ["addFavorite", ALICE, "낙지", 5000]);
    assert.match(changed.edit.content, /목표 \*\*5,000\*\*/);

    const off = await run(site, click("f:off:낙지"));
    assert.deepEqual(site.calls.filter((c) => c[0] === "addFavorite").at(-1), ["addFavorite", ALICE, "낙지", 0]);
    assert.equal(find(off.edit, "f:off:낙지").disabled, true);

    const removed = await run(site, click("f:del:낙지"));
    assert.deepEqual(site.favorites.get(ALICE), []);
    assert.match(removed.edit.content, /즐겨찾기가 없습니다/);
  });

  it("목표가 입력은 숫자만 받는다", async () => {
    await site.addFavorite(ALICE, "낙지", 4000);
    assert.match((await run(site, submit("f:t:낙지", { target: "abc" }))).view.content, /숫자로/);
    assert.match((await run(site, submit("f:t:낙지", { target: "" }))).view.content, /숫자로/);
  });

  it("즐겨찾기에 없는 항목의 상세는 안내만 한다", async () => {
    assert.match((await run(site, click("f:open", ["낙지"]))).edit.content, /즐겨찾기에 없는/);
  });
});

describe("아르바이트 알림", () => {
  beforeEach(register);

  it("항목이 많아 선택 메뉴 두 개로 나뉘고 구독한 항목이 체크되어 있다", async () => {
    await site.changeArbeitSubs(ALICE, { add: ["entry-1", "entry-17"] });
    const { initial, view } = await run(site, click("m:ab"));

    assert.equal(initial.type, 7);
    assert.match(view.content, /\*\*아르바이트 알림\*\* \(2개\)/);
    assert.match(view.content, /• 항목 1 · 에린 10시 이후/);
    const first = find(view, "a:0");
    const second = find(view, "a:1");
    assert.equal(first.options.length, 15);
    assert.equal(second.options.length, 5);
    assert.equal(first.min_values, 0);
    assert.deepEqual(first.options.filter((o) => o.default).map((o) => o.value), ["entry-1"]);
    assert.deepEqual(second.options.filter((o) => o.default).map((o) => o.value), ["entry-17"]);
    assert.equal(first.placeholder, "묶음0 ~ 묶음2");
  });

  it("구독이 없으면 고르라고 안내한다", async () => {
    assert.match((await run(site, click("m:ab"))).view.content, /구독한 항목이 없습니다/);
  });

  it("메뉴에서 고른 항목은 켜고 해제한 항목은 끈다", async () => {
    await site.changeArbeitSubs(ALICE, { add: ["entry-1", "entry-17"] });
    site.calls.length = 0;

    const result = await run(site, click("a:0", ["entry-2", "entry-3"]));
    assert.deepEqual(site.calls[0][2], {
      add: ["entry-2", "entry-3"],
      remove: ENTRIES.slice(0, 15).map((e) => e.id).filter((id) => id !== "entry-2" && id !== "entry-3"),
    });
    assert.deepEqual(site.users.get(ALICE).arbeit, ["entry-2", "entry-3", "entry-17"]);
    assert.match(result.view.content, /\(3개\)/);

    await run(site, click("a:1", []));
    assert.deepEqual(site.users.get(ALICE).arbeit, ["entry-2", "entry-3"]);
  });

  it("전체 켜기와 끄기", async () => {
    assert.match((await run(site, click("a:all"))).view.content, /\(20개\)/);
    assert.match((await run(site, click("a:none"))).view.content, /\(0개\)/);
  });
});

describe("알림 설정", () => {
  beforeEach(register);

  it("묶어서 받기와 일시정지를 단추로 켜고 끈다", async () => {
    const first = await run(site, click("m:set"));
    assert.equal(find(first.view, "s:digest").label, "묶어서 받기: 켜짐");

    const off = await run(site, click("s:digest"));
    assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { digest: false }]);
    assert.equal(find(off.view, "s:digest").label, "묶어서 받기: 꺼짐");

    const paused = await run(site, click("s:pause"));
    assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { paused: true }]);
    assert.equal(find(paused.view, "s:pause").style, 4);
    assert.match(paused.view.content, /일시정지/);
  });

  it("조용한 시간은 선택 메뉴의 목록에서 고른다", async () => {
    const result = await run(site, click("s:quiet", ["23-7"]));
    assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { quiet: { start: 23, end: 7 } }]);
    assert.deepEqual(find(result.view, "s:quiet").options.filter((o) => o.default).map((o) => o.value), ["23-7"]);

    const cleared = await run(site, click("s:quiet", ["off"]));
    assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { quiet: null }]);
    assert.match(cleared.view.content, /조용한 시간 없음/);
  });

  it("직접 입력한 조용한 시간은 선택 메뉴에 직접 설정으로 보인다", async () => {
    const result = await run(site, submit("s:custom", { start: "5", end: "9" }));
    assert.deepEqual(site.calls.at(-1), ["updateSettings", ALICE, { quiet: { start: 5, end: 9 } }]);
    const menu = find(result.view, "s:quiet");
    assert.equal(menu.options[0].value, "keep");
    assert.match(menu.options[0].label, /5시~9시/);

    const kept = await run(site, click("s:quiet", ["keep"]));
    assert.equal(site.calls.filter((c) => c[0] === "updateSettings").length, 1);
    assert.ok(kept.view);
  });

  it("직접 입력은 입력창을 열고 잘못된 값은 거절한다", async () => {
    assert.equal((await run(site, click("s:custom"))).view.custom_id, "s:custom");
    assert.match((await run(site, submit("s:custom", { start: "25", end: "3" }))).view.content, /0부터 23/);
    assert.match((await run(site, submit("s:custom", { start: "a", end: "3" }))).view.content, /0부터 23/);
    assert.match((await run(site, submit("s:custom", { start: "4", end: "4" }))).view.content, /같으면/);
    assert.equal(site.calls.filter((c) => c[0] === "updateSettings").length, 0);
  });

  it("DM 이 막혀 멈춘 사용자에게 푸는 방법을 알려 준다", async () => {
    site.users.get(ALICE).settings.paused = true;
    site.users.get(ALICE).settings.disabledReason = "dm-failed";
    assert.match((await run(site, click("m:set"))).view.content, /DM을 보낼 수 없어 멈춤/);
  });
});

describe("내 정보", () => {
  beforeEach(async () => {
    await register();
    await site.addFavorite(ALICE, "낙지", 4300);
    await site.changeArbeitSubs(ALICE, { add: ["entry-1"] });
  });

  it("저장된 정보를 요약해서 보여 준다", async () => {
    const { view } = await run(site, click("m:me"));
    assert.match(view.content, /즐겨찾기 1개 · 아르바이트 1개 · 동의 <t:\d+:R>/);
    assert.deepEqual(ids(view), ["me:ask", "m:menu"]);
  });

  it("확인 단추를 눌러야 지우고 취소하면 그대로다", async () => {
    const ask = await run(site, click("me:ask"));
    assert.deepEqual(ids(ask.view), ["me:del", "me:cancel"]);
    assert.equal(site.users.has(ALICE), true);

    assert.deepEqual(ids((await run(site, click("me:cancel"))).view), ["me:ask", "m:menu"]);
    assert.equal(site.users.has(ALICE), true);

    const done = await run(site, click("me:del"));
    assert.match(done.view.content, /삭제했습니다/);
    assert.equal(site.users.has(ALICE), false);
    assert.equal(site.favorites.has(ALICE), false);
  });
});

describe("오류", () => {
  it("사이트 Worker 가 실패하면 일반 안내로 답한다", async () => {
    site.fail = new Error("down");
    const result = await run(site, click("m:fav"));
    assert.match(result.view.content, /처리하지 못했습니다/);
    assert.equal(result.view.flags, 64);
  });

  it("자동완성은 실패해도 빈 목록을 준다", async () => {
    site.searchItems = async () => {
      throw new Error("down");
    };
    assert.deepEqual((await run(site, typing("낙"))).initial.data.choices, []);
  });

  it("처리 중으로 답한 뒤 실패하면 원래 메시지를 안내 문구로 바꾼다", async () => {
    await register();
    site.favoritesStatus = async () => {
      throw new Error("db exploded");
    };
    const result = await run(site, click("m:fav"));
    assert.equal(result.initial.type, 6);
    assert.match(result.edit.content, /처리하지 못했습니다/);

    site.favoritesStatus = async () => {
      throw new Error("즐겨찾기는 20개까지 둘 수 있습니다.");
    };
    assert.match((await run(site, click("m:fav"))).edit.content, /20개까지/);
  });

  it("알 수 없는 상호작용은 지원하지 않는다고 답한다", async () => {
    const result = await run(site, { type: 99, member: { user: { id: ALICE } }, data: {} });
    assert.match(result.view.content, /지원하지 않는/);
  });
});
