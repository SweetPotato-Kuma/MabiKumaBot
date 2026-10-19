import {
  CONSENT_VERSION,
  QUIET_PRESETS,
  arbeitView,
  candidatesView,
  chunkEntries,
  confirmDeleteView,
  consentView,
  deletedView,
  erinText,
  erinView,
  favoriteDetailView,
  favoritesView,
  meView,
  menuView,
  noticeView,
  priceView,
  button,
  settingsView,
} from "./views.js";
import { editOriginal } from "./discord.js";

export { CONSENT_VERSION };

const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const AUTOCOMPLETE = 4;
const MODAL_SUBMIT = 5;

const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;
const DEFERRED_UPDATE = 6;
const UPDATE_MESSAGE = 7;
const AUTOCOMPLETE_RESULT = 8;
const MODAL = 9;
const EPHEMERAL = 64;

const STRING = 3;
const MAX_TARGET = 10_000_000_000;
const ERROR_TEXT = "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
const PERSONAL_TARGETS = new Set(["fav", "ab", "set", "me"]);

/** 디스코드에 등록하는 명령. `/마비쿠마` 하나로 열고 나머지는 모두 화면의 버튼과 메뉴로 한다. */
export const COMMANDS = [
  {
    type: 1,
    name: "마비쿠마",
    description: "마비쿠마 메뉴 열기",
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

export const userIdOf = (interaction) => interaction?.member?.user?.id ?? interaction?.user?.id ?? null;

// ---------- 응답 만들기 ----------
const ephemeralFlags = (ephemeral) => (ephemeral ? { flags: EPHEMERAL } : {});
const newMessage = (view, { ephemeral = true } = {}) => ({
  body: { type: CHANNEL_MESSAGE, data: { ...view, ...ephemeralFlags(ephemeral) } },
});
const update = (view) => ({ body: { type: UPDATE_MESSAGE, data: view } });
const modal = (customId, title, inputs) => ({
  body: {
    type: MODAL,
    data: {
      custom_id: customId,
      title,
      components: inputs.map((input) => ({
        type: 1,
        components: [
          {
            type: 4,
            custom_id: input.id,
            label: input.label,
            style: 1,
            required: input.required ?? true,
            max_length: input.max ?? 100,
            ...(input.placeholder ? { placeholder: input.placeholder } : {}),
          },
        ],
      })),
    },
  },
});
/** 넥슨을 읽는 화면은 3초 안에 끝나지 않을 수 있어 먼저 "처리 중"으로 답하고 나중에 내용을 채운다. */
const deferred = (kind, run) => ({ defer: kind, run });
const message = (text) => newMessage(noticeView(text));

// ---------- 입력 읽기 ----------
function fieldsOf(interaction) {
  const fields = {};
  for (const row of interaction?.data?.components ?? []) {
    for (const component of row.components ?? []) fields[component.custom_id] = component.value ?? "";
  }
  return fields;
}

/** 목표 가격 입력. 비우면 undefined, 0 이면 끔, 숫자가 아니면 null. */
function parseTarget(text) {
  const clean = String(text ?? "").replace(/[,\s]/g, "");
  if (clean === "") return undefined;
  if (!/^\d+$/.test(clean)) return null;
  const value = Number(clean);
  return value <= MAX_TARGET ? value : null;
}

// ---------- 화면 읽어 오기 ----------
async function overview(env, uid, user) {
  const favorites = await env.SITE.listFavorites(uid).catch(() => []);
  return { favorites: favorites.length, arbeit: user.arbeit.length, paused: user.settings.paused };
}

async function priceViewFor(env, name, options) {
  const summary = await env.SITE.marketSummary(name);
  if (!summary) {
    return noticeView(`**${name}** 최근 거래 기록이 없습니다.`, button("m:price", "다른 아이템", 1));
  }
  return priceView(summary, options);
}

async function favoritesListView(env, uid) {
  return favoritesView(await env.SITE.favoritesStatus(uid));
}

async function favoriteDetail(env, uid, name) {
  const [summary, favorites] = await Promise.all([
    env.SITE.marketSummary(name),
    env.SITE.listFavorites(uid),
  ]);
  const found = favorites.find((favorite) => favorite.name === name);
  if (!found) return noticeView("즐겨찾기에 없는 아이템입니다.", button("f:list", "← 목록"));
  return favoriteDetailView(name, summary, found.targetPrice);
}

/** 입력한 이름이 거래 기록이 있는 아이템 하나로 정해지는지. 앞부분이 같은 것이 여럿이면 후보를 돌려준다. */
async function lookup(env, input) {
  const typed = String(input ?? "").trim();
  if (typed === "") return { candidates: [] };
  const names = await env.SITE.searchItems(typed);
  if (names.includes(typed)) return { name: typed };
  if (names.length === 1) return { name: names[0] };
  return { candidates: names };
}

// ---------- 화면 열기 ----------
/** 개인 기능은 동의한 사용자만. 아니면 동의 화면으로 보내고 동의한 뒤 원래 화면을 연다. */
async function personal(env, uid, target, open) {
  const user = await env.SITE.getUser(uid);
  if (!user) return update(consentView(target));
  return open(user);
}

async function openTarget(env, uid, target, now) {
  switch (target) {
    case "menu": {
      const user = await env.SITE.getUser(uid);
      return update(menuView(user ? await overview(env, uid, user) : null));
    }
    case "price":
      return modal("p:q", "시세 조회", [
        { id: "name", label: "아이템 이름", max: 80, placeholder: "이름의 앞부분도 됩니다 (예: 낙지)" },
      ]);
    case "erin":
      return update(erinView(now));
    case "fav":
      return personal(env, uid, "fav", () => deferred("update", () => favoritesListView(env, uid)));
    case "ab":
      return personal(env, uid, "ab", async (user) =>
        update(arbeitView(await env.SITE.listArbeitEntries(), user.arbeit)),
      );
    case "set":
      return personal(env, uid, "set", (user) => update(settingsView(user.settings)));
    case "me":
      return personal(env, uid, "me", async (user) =>
        update(meView(user, (await env.SITE.listFavorites(uid)).length)),
      );
    default:
      return update(menuView(null));
  }
}

// ---------- 버튼과 선택 메뉴 ----------
async function priceComponent(env, interaction, act, rest, values) {
  const uid = userIdOf(interaction);
  switch (act) {
    case "pick":
      return deferred("update", () => priceViewFor(env, values[0]));
    case "r":
      return deferred("update", () => priceViewFor(env, rest));
    case "share":
      return deferred("public", () => priceViewFor(env, rest, { share: true }));
    case "fav": {
      const user = await env.SITE.getUser(uid);
      if (!user) return newMessage(consentView("fav"));
      await env.SITE.addFavorite(uid, rest, undefined);
      return newMessage(
        noticeView(`**${rest}** 즐겨찾기에 더했습니다. 즐겨찾기에서 목표가를 정할 수 있습니다.`, button("m:fav", "즐겨찾기 열기", 1)),
      );
    }
    default:
      return message("만료된 단추입니다. /마비쿠마 를 다시 실행해 주세요.");
  }
}

async function favoritesComponent(env, interaction, act, rest, values) {
  const uid = userIdOf(interaction);
  switch (act) {
    case "open":
      return deferred("update", () => favoriteDetail(env, uid, values[0]));
    case "list":
      return deferred("update", () => favoritesListView(env, uid));
    case "add":
      return modal("f:add", "즐겨찾기 추가", [
        { id: "name", label: "아이템 이름", max: 80, placeholder: "이름의 앞부분도 됩니다 (예: 낙지)" },
        { id: "target", label: "목표가 (개당, 비워도 됩니다)", required: false, max: 12, placeholder: "예: 4300" },
      ]);
    case "t":
      return modal(`f:t:${rest}`, "목표가 정하기", [
        { id: "target", label: "개당 목표가 (0이면 알림 끔)", max: 12, placeholder: "예: 4300" },
      ]);
    case "off":
      await env.SITE.addFavorite(uid, rest, 0);
      return deferred("update", () => favoriteDetail(env, uid, rest));
    case "del":
      await env.SITE.removeFavorite(uid, rest);
      return deferred("update", () => favoritesListView(env, uid));
    case "pa": {
      const target = rest === "-" ? undefined : Number(rest);
      await env.SITE.addFavorite(uid, values[0], target);
      return deferred("update", () => favoriteDetail(env, uid, values[0]));
    }
    default:
      return message("만료된 단추입니다. /마비쿠마 를 다시 실행해 주세요.");
  }
}

async function arbeitComponent(env, interaction, act, values) {
  const uid = userIdOf(interaction);
  const entries = await env.SITE.listArbeitEntries();
  let subscribed;
  if (act === "all") {
    subscribed = await env.SITE.changeArbeitSubs(uid, { all: true });
  } else if (act === "none") {
    subscribed = await env.SITE.changeArbeitSubs(uid, { none: true });
  } else {
    const chunk = (chunkEntries(entries)[Number(act)] ?? []).map((entry) => entry.id);
    subscribed = await env.SITE.changeArbeitSubs(uid, {
      add: values.filter((id) => chunk.includes(id)),
      remove: chunk.filter((id) => !values.includes(id)),
    });
  }
  return update(arbeitView(entries, subscribed));
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
  if (act === "del") {
    await env.SITE.deleteUser(uid);
    return update(deletedView());
  }
  return openTarget(env, uid, "me");
}

async function component(env, interaction, now) {
  const uid = userIdOf(interaction);
  const values = interaction.data.values ?? [];
  const [namespace, act, ...parts] = String(interaction.data.custom_id).split(":");
  const rest = parts.join(":");
  switch (namespace) {
    case "m":
      return openTarget(env, uid, act, now);
    case "c":
      if (!PERSONAL_TARGETS.has(rest)) return update(menuView(null));
      await env.SITE.registerUser(uid, CONSENT_VERSION);
      return openTarget(env, uid, rest, now);
    case "p":
      return priceComponent(env, interaction, act, rest, values);
    case "f":
      return favoritesComponent(env, interaction, act, rest, values);
    case "a":
      return arbeitComponent(env, interaction, act, values);
    case "s":
      return settingsComponent(env, interaction, act, values);
    case "me":
      return meComponent(env, interaction, act);
    case "e":
      return act === "share"
        ? newMessage({ content: erinText(now) }, { ephemeral: false })
        : update(erinView(now));
    default:
      return message("만료된 단추입니다. /마비쿠마 를 다시 실행해 주세요.");
  }
}

// ---------- 입력창 제출 ----------
async function addFavoriteFrom(env, uid, name, target) {
  await env.SITE.addFavorite(uid, name, target);
  return deferred("update", () => favoriteDetail(env, uid, name));
}

async function modalSubmit(env, interaction) {
  const uid = userIdOf(interaction);
  const fields = fieldsOf(interaction);
  const [namespace, act, ...parts] = String(interaction.data.custom_id).split(":");
  const rest = parts.join(":");

  if (namespace === "p" && act === "q") {
    const found = await lookup(env, fields.name);
    if (found.name) return deferred("update", () => priceViewFor(env, found.name));
    return update(candidatesView(fields.name, found.candidates, "p:pick", "m:price"));
  }

  if (namespace === "f" && act === "add") {
    const target = parseTarget(fields.target);
    if (target === null) return message("목표가는 숫자로 입력해 주세요.");
    const found = await lookup(env, fields.name);
    if (found.name) return addFavoriteFrom(env, uid, found.name, target);
    return update(candidatesView(fields.name, found.candidates, `f:pa:${target ?? "-"}`, "f:add"));
  }

  if (namespace === "f" && act === "t") {
    const target = parseTarget(fields.target);
    if (target === null || target === undefined) return message("목표가는 숫자로 입력해 주세요.");
    return addFavoriteFrom(env, uid, rest, target);
  }

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
async function slash(env, interaction, now) {
  const uid = userIdOf(interaction);
  const name = String(interaction.data.options?.find((option) => option.name === "아이템")?.value ?? "").trim();
  if (name !== "") {
    return deferred("new", async () => {
      const found = await lookup(env, name);
      if (found.name) return priceViewFor(env, found.name);
      return candidatesView(name, found.candidates, "p:pick", "m:price");
    });
  }
  const user = await env.SITE.getUser(uid);
  return newMessage(menuView(user ? await overview(env, uid, user) : null));
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
    // 사이트 Worker 가 사용자에게 보여도 되는 이유(한도, 잘못된 입력)를 던지면 그대로 알려 준다.
    const text = String(error?.message ?? "");
    const shown = /즐겨찾기|목표 가격|거래 기록|동의/.test(text) ? text : ERROR_TEXT;
    return interaction.type === AUTOCOMPLETE
      ? { type: AUTOCOMPLETE_RESULT, data: { choices: [] } }
      : message(shown).body;
  }
  if (!result.defer) return result.body;

  const finish = async () => {
    let view;
    try {
      view = await result.run();
    } catch (error) {
      const text = String(error?.message ?? "");
      view = noticeView(/즐겨찾기|목표 가격|거래 기록|동의/.test(text) ? text : ERROR_TEXT);
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
