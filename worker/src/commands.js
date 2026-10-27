import { editOriginal } from "./discord.js";
import { DEFAULT_HOUR, dailyComponent, dailySettingsView, guildComponent, isGuildAdmin } from "./daily.js";
import { openPrice, priceComponent, priceModal, priceModalSubmit } from "./price.js";
import { savedComponent, savedList } from "./saved.js";
import {
  deferred,
  fieldsOf,
  keepFormat,
  message,
  modal,
  newMessage,
  noticeView,
  update,
  userIdOf,
} from "./ui.js";
import {
  CONSENT_VERSION,
  ARBEIT_PAGE_SIZE,
  QUIET_PRESETS,
  arbeitGroups,
  arbeitView,
  confirmDeleteView,
  consentView,
  deletedView,
  erinText,
  erinView,
  linkCodeView,
  meView,
  menuView,
  settingsView,
} from "./views.js";

export { CONSENT_VERSION, userIdOf };

const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const AUTOCOMPLETE = 4;
const MODAL_SUBMIT = 5;

const DEFERRED_CHANNEL_MESSAGE = 5;
const DEFERRED_UPDATE = 6;
const AUTOCOMPLETE_RESULT = 8;
const EPHEMERAL = 64;

const STRING = 3;
const ERROR_TEXT = "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
const EXPIRED = "만료된 단추입니다. /마비쿠마 를 다시 실행해 주세요.";
const PERSONAL_TARGETS = new Set(["fav", "ab", "set", "me"]);
/** 사이트 Worker 가 사용자에게 보여 줘도 되는 이유로 던진 오류. 나머지는 일반 안내로 바꾼다. */
const SHOWN_ERRORS = /즐겨찾기|목표 가격|동의|검색어나 분류|이미 저장|찾지 못했|조건|숫자 범위|사이트에서|경매장|R 또는 S|펫 정보/;

/** 명령을 쓸 수 있는 설치 방식: 서버에 설치(0), 사용자 계정에 설치(1). */
const INSTALL_GUILD_AND_USER = [0, 1];
/** 명령을 쓸 수 있는 곳: 서버(0), 봇과의 DM(1), 사용자 설치로 들어간 DM·그룹 DM(2). */
const ANYWHERE = [0, 1, 2];

/**
 * 디스코드에 등록하는 명령. `/마비쿠마` 하나로 열고 나머지는 모두 화면의 버튼과 메뉴로 한다.
 * 개인 기능뿐이라 서버에 들이지 않고 사용자 계정에 설치해도 쓸 수 있게 한다(설치 방식을 비우면 등록 당시 앱 설정을 따라간다).
 */
export const COMMANDS = [
  {
    type: 1,
    name: "마비쿠마",
    description: "마비쿠마 메뉴 열기",
    integration_types: INSTALL_GUILD_AND_USER,
    contexts: ANYWHERE,
    options: [
      {
        type: STRING,
        name: "아이템",
        description: "바로 시세를 볼 아이템 (비우면 메뉴가 열립니다)",
        autocomplete: true,
      },
    ],
  },
];

// ---------- 화면 열기 ----------
async function overview(env, uid, user) {
  const searches = await env.SITE.listSearches(uid).catch(() => []);
  return { favorites: searches.length, arbeit: user.arbeit.length, paused: user.settings.paused };
}

/** 개인 기능은 동의한 사용자만. 아니면 동의 화면으로 보내고 동의한 뒤 원래 화면을 연다. */
async function personal(env, uid, target, open) {
  const user = await env.SITE.getUser(uid);
  if (!user) return update(consentView(target));
  return open(user);
}

async function openTarget(env, uid, target, now, interaction) {
  switch (target) {
    case "menu": {
      const user = await env.SITE.getUser(uid);
      return update(menuView(user ? await overview(env, uid, user) : null, { guildAdmin: isGuildAdmin(interaction) }));
    }
    // 예전 메뉴의 경매장 검색 단추도 시세 보기로 잇는다.
    case "search":
    case "price":
      return priceModal();
    case "erin":
      return update(erinView(now));
    case "fav":
      return personal(env, uid, "fav", () => deferred("update", () => savedList(env, uid)));
    case "ab":
      // 새 형식 화면이라 지금 메시지를 고치지 못하고 새 메시지로 연다.
      return personal(env, uid, "ab", async (user) =>
        newMessage(arbeitView(await env.SITE.listArbeitEntries(), user.arbeit)),
      );
    case "set":
      return personal(env, uid, "set", (user) => update(settingsView(user.settings)));
    case "me":
      return personal(env, uid, "me", async (user) => {
        const [searches, link] = await Promise.all([env.SITE.listSearches(uid), env.SITE.linkStatus(uid)]);
        return update(meView(user, searches.length, link.linked));
      });
    default:
      return update(menuView(null));
  }
}

// ---------- 버튼과 선택 메뉴 ----------
/**
 * 묶음 칸(a:g:묶음 번호)에서 고르면 그 묶음의 다른 항목은 끈다. 쪽 넘기기(a:p:쪽)와 전체 끄기(a:none:쪽).
 * 예전 메시지의 단추(a:0, a:all)는 만료로 본다.
 */
async function arbeitComponent(env, interaction, act, rest, values) {
  const uid = userIdOf(interaction);
  const user = await env.SITE.getUser(uid);
  if (!user) return update(consentView("ab"));
  const entries = await env.SITE.listArbeitEntries();
  let subscribed = user.arbeit;
  let page = Number(rest) || 0;
  if (act === "g") {
    const index = Number(rest);
    const group = arbeitGroups(entries)[index];
    if (!group) return null;
    const ids = group.entries.map((entry) => entry.id);
    const chosen = ids.includes(values[0]) ? values[0] : null;
    subscribed = await env.SITE.changeArbeitSubs(uid, {
      add: chosen ? [chosen] : [],
      remove: ids.filter((id) => id !== chosen),
    });
    page = Math.floor(index / ARBEIT_PAGE_SIZE);
  } else if (act === "none") {
    subscribed = await env.SITE.changeArbeitSubs(uid, { none: true });
  } else if (act !== "p") {
    return null;
  }
  return update(arbeitView(entries, subscribed, page));
}

async function settingsComponent(env, interaction, act, values) {
  const uid = userIdOf(interaction);
  const user = await env.SITE.getUser(uid);
  if (!user) return update(consentView("set"));
  if (act === "custom") {
    return modal("s:custom", "조용한 시간", [
      { id: "start", label: "시작 시각 (한국 시각 0~23)", max: 2, placeholder: "예: 23" },
      { id: "end", label: "끝 시각 (한국 시각 0~23)", max: 2, placeholder: "예: 7" },
    ]);
  }
  if (act === "daily") return update(dailySettingsView(user.settings));
  if (act === "dailyr") {
    return update(dailySettingsView(await env.SITE.updateSettings(uid, { dailyRemind: user.settings.dailyRemind === false })));
  }
  if (act === "dailyon" || act === "dailyoff" || act === "dailyh") {
    const daily = act === "dailyoff" ? null : act === "dailyon" ? DEFAULT_HOUR : Number(values[0]);
    return update(dailySettingsView(await env.SITE.updateSettings(uid, { daily })));
  }
  let patch = {};
  if (act === "digest") patch = { digest: !user.settings.digest };
  if (act === "pause") patch = { paused: !user.settings.paused };
  if (act === "quiet") {
    if (values[0] === "keep") return update(settingsView(user.settings));
    const preset = QUIET_PRESETS.find(([value]) => value === values[0]);
    patch = { quiet: preset ? preset[2] : null };
  }
  return update(settingsView(await env.SITE.updateSettings(uid, patch)));
}

async function meComponent(env, interaction, act) {
  const uid = userIdOf(interaction);
  if (act === "ask") return update(confirmDeleteView());
  if (act === "link") {
    if (!(await env.SITE.getUser(uid))) return newMessage(consentView("me"));
    const { code } = await env.SITE.createLinkCode(uid);
    return newMessage(linkCodeView(code));
  }
  if (act === "unlink") {
    await env.SITE.unlinkDiscord(uid);
    return openTarget(env, uid, "me");
  }
  if (act === "del") {
    await env.SITE.deleteUser(uid);
    return update(deletedView());
  }
  return openTarget(env, uid, "me");
}

async function component(env, interaction, now) {
  return keepFormat(interaction, await componentResponse(env, interaction, now));
}

async function componentResponse(env, interaction, now) {
  const uid = userIdOf(interaction);
  const values = interaction.data.values ?? [];
  const [namespace, act, ...parts] = String(interaction.data.custom_id).split(":");
  const rest = parts.join(":");
  let result = null;
  switch (namespace) {
    case "m":
      return openTarget(env, uid, act, now, interaction);
    case "c":
      if (!PERSONAL_TARGETS.has(rest)) return update(menuView(null));
      await env.SITE.registerUser(uid, CONSENT_VERSION);
      return openTarget(env, uid, rest, now, interaction);
    case "q":
      // 봇의 경매장 검색 화면(q:, k:)은 뺐다. 예전 메시지의 단추는 만료로 안내한다.
      break;
    case "p":
      result = await priceComponent(env, interaction, act, rest, values);
      break;
    case "f":
      result = await savedComponent(env, interaction, act, rest, values);
      break;
    case "a":
      result = await arbeitComponent(env, interaction, act, rest, values);
      break;
    case "d":
      result = await dailyComponent(env, interaction, act);
      break;
    case "g":
      result = await guildComponent(env, interaction, act, values);
      break;
    case "s":
      return settingsComponent(env, interaction, act, values);
    case "me":
      return meComponent(env, interaction, act);
    case "e":
      return act === "share"
        ? newMessage({ content: erinText(now) }, { ephemeral: false })
        : update(erinView(now));
    default:
      break;
  }
  return result ?? message(EXPIRED);
}

// ---------- 입력창 제출 ----------
async function modalSubmit(env, interaction) {
  const uid = userIdOf(interaction);
  const fields = fieldsOf(interaction);
  const [namespace, act, ...parts] = String(interaction.data.custom_id).split(":");
  const rest = parts.join(":");

  if (namespace === "p" && act === "m") return priceModalSubmit(env, interaction, fields);
  if (namespace === "s" && act === "custom") {
    const start = Number(fields.start);
    const end = Number(fields.end);
    const valid = (value) => Number.isInteger(value) && value >= 0 && value <= 23;
    if (!valid(start) || !valid(end)) return message("시각은 0부터 23 사이의 숫자로 입력해 주세요.");
    if (start === end) return message("시작과 끝이 같으면 조용한 시간이 없습니다.");
    return update(settingsView(await env.SITE.updateSettings(uid, { quiet: { start, end } })));
  }
  return message("만료된 입력창입니다. /마비쿠마 를 다시 실행해 주세요.");
}

// ---------- 명령과 자동완성 ----------
/** /마비쿠마 아이템:… 은 그 이름으로 바로 검색한다. 자동완성에서 고른 이름이면 정확히 일치로 찾는다. */
async function slash(env, interaction) {
  const uid = userIdOf(interaction);
  const name = String(interaction.data.options?.find((option) => option.name === "아이템")?.value ?? "").trim();
  if (name !== "") {
    return deferred("new", () => openPrice(env, uid, name));
  }
  const user = await env.SITE.getUser(uid);
  return newMessage(menuView(user ? await overview(env, uid, user) : null, { guildAdmin: isGuildAdmin(interaction) }));
}

async function autocomplete(env, interaction) {
  const focused = interaction.data.options?.find((option) => option.focused);
  const names = focused ? await env.SITE.searchItems(String(focused.value ?? "")) : [];
  return {
    body: {
      type: AUTOCOMPLETE_RESULT,
      data: {
        choices: names.slice(0, 25).map((name) => ({ name: name.slice(0, 100), value: name.slice(0, 100) })),
      },
    },
  };
}

async function route(env, interaction, now) {
  switch (interaction.type) {
    case APPLICATION_COMMAND:
      return slash(env, interaction, now);
    case MESSAGE_COMPONENT:
      return component(env, interaction, now);
    case MODAL_SUBMIT:
      return modalSubmit(env, interaction);
    case AUTOCOMPLETE:
      return autocomplete(env, interaction);
    default:
      return message("아직 지원하지 않는 동작입니다.");
  }
}

const INITIAL = {
  update: () => ({ type: DEFERRED_UPDATE }),
  new: () => ({ type: DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } }),
  public: () => ({ type: DEFERRED_CHANNEL_MESSAGE }),
};

const shownText = (error) => {
  const text = String(error?.message ?? "");
  return SHOWN_ERRORS.test(text) ? text : ERROR_TEXT;
};

/**
 * 상호작용 하나를 처리해 디스코드에 돌려줄 응답을 만든다.
 * 넥슨을 읽는 화면은 먼저 처리 중으로 답하고, ctx.waitUntil 로 나중에 원래 메시지를 채운다(ctx 가 없으면 기다렸다 채운다).
 */
export async function handleInteraction(interaction, env, ctx, now = Date.now()) {
  if (interaction.type === PING) return { type: 1 };

  let result;
  try {
    result = await route(env, interaction, now);
  } catch (error) {
    return interaction.type === AUTOCOMPLETE
      ? { type: AUTOCOMPLETE_RESULT, data: { choices: [] } }
      : message(shownText(error)).body;
  }
  if (!result.defer) return result.body;

  const finish = async () => {
    let view;
    try {
      view = await result.run();
    } catch (error) {
      view = noticeView(shownText(error));
    }
    await editOriginal(env, interaction, view);
  };
  if (ctx?.waitUntil) {
    ctx.waitUntil(finish());
  } else {
    await finish();
  }
  return INITIAL[result.defer]();
}
