import { erinClock, formatErinClock, formatShopReset, msUntilShopReset } from "./erin.js";
import { favoritesStatusMessages, marketText, won } from "./format.js";

const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;
const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;
const CHAT_INPUT = 1;

const CHANNEL_MESSAGE = 4;
const UPDATE_MESSAGE = 7;
const AUTOCOMPLETE_RESULT = 8;
const EPHEMERAL = 64;
const MAX_TARGET = 10_000_000_000;

/** 동의 문구가 바뀌면 이 값과 사이트의 개인정보처리방침을 함께 고친다. */
export const CONSENT_VERSION = "2026-10-19";
const PRIVACY_URL = "https://mabi.spkuma.com/privacy";

const entryOption = {
  type: STRING,
  name: "항목",
  description: "아르바이트 항목",
  required: true,
  autocomplete: true,
};

const itemOption = (description) => ({
  type: STRING,
  name: "아이템",
  description,
  required: true,
  autocomplete: true,
});

/** 디스코드에 등록하는 명령 정의. 루트 명령 `/구마` 하나에 서브명령을 모은다. */
export const COMMANDS = [
  {
    type: CHAT_INPUT,
    name: "구마",
    description: "마비노기 도우미",
    options: [
      {
        type: SUBCOMMAND,
        name: "에린",
        description: "지금 에린 시각과 상점이 바뀔 때까지 남은 시간",
      },
      {
        type: SUBCOMMAND,
        name: "시세",
        description: "아이템의 현재 최저가와 최근 거래 시세",
        options: [itemOption("아이템 이름")],
      },
      {
        type: SUBCOMMAND_GROUP,
        name: "즐겨찾기",
        description: "자주 보는 아이템과 목표 가격 알림",
        options: [
          {
            type: SUBCOMMAND,
            name: "추가",
            description: "즐겨찾기에 더하거나 목표 가격 바꾸기",
            options: [
              itemOption("아이템 이름"),
              {
                type: INTEGER,
                name: "목표가",
                description: "개당 이 가격 이하가 되면 알림 (0이면 알림 끔)",
                min_value: 0,
                max_value: MAX_TARGET,
              },
            ],
          },
          {
            type: SUBCOMMAND,
            name: "삭제",
            description: "즐겨찾기에서 빼기",
            options: [itemOption("즐겨찾기에서 뺄 아이템")],
          },
          { type: SUBCOMMAND, name: "목록", description: "즐겨찾기의 현재 최저가와 목표 가격" },
        ],
      },
      {
        type: SUBCOMMAND_GROUP,
        name: "알바",
        description: "아르바이트 보고 가능 알림",
        options: [
          { type: SUBCOMMAND, name: "목록", description: "내가 구독한 항목" },
          { type: SUBCOMMAND, name: "추가", description: "알림을 받을 항목 추가", options: [entryOption] },
          { type: SUBCOMMAND, name: "삭제", description: "알림을 끌 항목 삭제", options: [entryOption] },
          { type: SUBCOMMAND, name: "전체켜기", description: "모든 항목을 구독" },
          { type: SUBCOMMAND, name: "전체끄기", description: "모든 구독을 해제" },
        ],
      },
      {
        type: SUBCOMMAND,
        name: "알림설정",
        description: "알림을 받는 방식 (값을 주지 않으면 현재 설정을 보여 줌)",
        options: [
          { type: BOOLEAN, name: "묶어서받기", description: "같은 시각 알림을 한 메시지로 받기" },
          { type: BOOLEAN, name: "일시정지", description: "모든 알림을 잠시 멈추기" },
          {
            type: INTEGER,
            name: "조용한시작",
            description: "알림을 받지 않을 시간의 시작(한국 시각, 0~23)",
            min_value: 0,
            max_value: 23,
          },
          {
            type: INTEGER,
            name: "조용한끝",
            description: "알림을 받지 않을 시간의 끝(한국 시각, 0~23)",
            min_value: 0,
            max_value: 23,
          },
          { type: BOOLEAN, name: "조용한시간끄기", description: "조용한 시간 설정을 지우기" },
        ],
      },
      {
        type: SUBCOMMAND_GROUP,
        name: "내정보",
        description: "봇에 저장된 내 정보",
        options: [
          {
            type: SUBCOMMAND,
            name: "삭제",
            description: "저장된 설정, 구독, 즐겨찾기를 모두 삭제",
          },
        ],
      },
    ],
  },
];

const ERROR_TEXT = "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

function reply(content, { ephemeral = true, components } = {}) {
  return {
    type: CHANNEL_MESSAGE,
    data: { content, flags: ephemeral ? EPHEMERAL : 0, ...(components ? { components } : {}) },
  };
}

const button = (customId, label, style) => ({ type: 2, custom_id: customId, label, style });
const linkButton = (label, url) => ({ type: 2, style: 5, label, url });
const row = (...buttons) => ({ type: 1, components: buttons });

/** 명령 이름 경로, 입력값, 자동완성 중인 입력을 꺼낸다. */
export function parseInteraction(interaction) {
  const path = [interaction?.data?.name];
  let options = interaction?.data?.options ?? [];
  while (options[0] && (options[0].type === SUBCOMMAND || options[0].type === SUBCOMMAND_GROUP)) {
    path.push(options[0].name);
    options = options[0].options ?? [];
  }
  return {
    path,
    values: Object.fromEntries(options.map((option) => [option.name, option.value])),
    focused: options.find((option) => option.focused) ?? null,
  };
}

export function userIdOf(interaction) {
  return interaction?.member?.user?.id ?? interaction?.user?.id ?? null;
}

function consentPrompt() {
  return reply(
    [
      "**개인 기능을 켜려면 동의가 필요합니다.**",
      "저장하는 정보: 디스코드 사용자 번호, 동의 시점, 알림 설정, 구독한 아르바이트 항목, 즐겨찾기와 목표 가격",
      "쓰는 곳: 알림을 DM으로 보내는 데에만 씁니다.",
      "지우는 방법: `/구마 내정보 삭제`",
      `자세한 내용: ${PRIVACY_URL}`,
    ].join("\n"),
    { components: [row(button("consent:agree", "동의하고 시작", 3))] },
  );
}

function erinReply(now) {
  const clock = erinClock(now);
  const phase = clock.day ? "낮" : "밤";
  return reply(
    `에린 시각 **${formatErinClock(clock)}** (${phase})\n다음 상점 교체까지 **${formatShopReset(msUntilShopReset(now))}**`,
    { ephemeral: false },
  );
}

export function marketReply(summary) {
  if (!summary) {
    return reply("최근 거래 기록이 없습니다. 이름을 자동완성에서 골라 주세요.");
  }
  return reply(marketText(summary), {
    ephemeral: false,
    components: [
      row(linkButton("아이템 페이지", summary.links.item), linkButton("경매장에서 보기", summary.links.auction)),
    ],
  });
}

function describeSettings(settings) {
  const parts = [settings.digest ? "한 메시지로 묶어 받기" : "항목마다 따로 받기"];
  if (settings.quiet) {
    parts.push(`조용한 시간 ${settings.quiet.start}시~${settings.quiet.end}시`);
  }
  if (settings.disabledReason === "dm-failed") {
    parts.push("DM을 보낼 수 없어 멈춤 (DM을 허용하고 `/구마 알림설정 일시정지:False`)");
  } else if (settings.paused) {
    parts.push("일시정지");
  }
  return parts.join(" · ");
}

function listReply(user, entries) {
  const names = new Map(entries.map((entry) => [entry.id, entry.label]));
  const lines = [`**내 아르바이트 알림** (${user.arbeit.length}개)`];
  if (user.arbeit.length === 0) {
    lines.push("구독한 항목이 없습니다. `/구마 알바 추가`로 고르세요.");
  } else {
    lines.push(...user.arbeit.map((id) => `• ${names.get(id) ?? id}`));
  }
  lines.push(describeSettings(user.settings));
  return reply(lines.join("\n"));
}

/** 입력이 항목 번호이거나 이름이 하나로 좁혀지면 그 항목을 돌려준다. */
function resolveEntry(entries, input) {
  const value = String(input ?? "").trim();
  const exact = entries.find((entry) => entry.id === value || entry.label === value);
  if (exact) {
    return { entry: exact };
  }
  const matches = entries.filter((entry) => entry.label.includes(value) || entry.group.includes(value));
  if (value !== "" && matches.length === 1) {
    return { entry: matches[0] };
  }
  return { matches };
}

function ambiguousReply(matches, input) {
  if (matches.length === 0) {
    return reply(`'${input}'에 맞는 항목이 없습니다. 입력하면서 나오는 목록에서 골라 주세요.`);
  }
  return reply(`'${input}'에 맞는 항목이 ${matches.length}개입니다. 목록에서 하나를 골라 주세요.`);
}

async function arbeitCommand(interaction, env, sub, values) {
  const id = userIdOf(interaction);
  const user = await env.SITE.getUser(id);
  if (!user) {
    return consentPrompt();
  }

  if (sub === "목록") {
    return listReply(user, await env.SITE.listArbeitEntries());
  }
  if (sub === "전체켜기") {
    const subs = await env.SITE.changeArbeitSubs(id, { all: true });
    return reply(`모든 아르바이트 ${subs.length}개를 구독했습니다.`);
  }
  if (sub === "전체끄기") {
    await env.SITE.changeArbeitSubs(id, { none: true });
    return reply("모든 구독을 해제했습니다.");
  }
  if (sub === "추가" || sub === "삭제") {
    const { entry, matches } = resolveEntry(await env.SITE.listArbeitEntries(), values.항목);
    if (!entry) {
      return ambiguousReply(matches, values.항목);
    }
    await env.SITE.changeArbeitSubs(id, sub === "추가" ? { add: [entry.id] } : { remove: [entry.id] });
    return reply(sub === "추가" ? `**${entry.label}** 알림을 켰습니다.` : `**${entry.label}** 알림을 껐습니다.`);
  }
  return reply("아직 지원하지 않는 명령입니다.");
}

async function favoritesCommand(interaction, env, sub, values) {
  const id = userIdOf(interaction);
  if (!(await env.SITE.getUser(id))) {
    return consentPrompt();
  }

  if (sub === "목록") {
    const messages = favoritesStatusMessages(await env.SITE.favoritesStatus(id));
    return reply(messages[0]);
  }
  const name = String(values.아이템 ?? "").trim();
  if (sub === "삭제") {
    await env.SITE.removeFavorite(id, name);
    return reply(`**${name}** 즐겨찾기를 뺐습니다.`);
  }
  if (sub === "추가") {
    const favorites = await env.SITE.addFavorite(id, name, values.목표가);
    const saved = favorites.find((favorite) => favorite.name === name);
    const target = saved?.targetPrice
      ? `개당 **${won(saved.targetPrice)}** 이하가 되면 DM으로 알립니다.`
      : "목표가를 정하면 그 가격 이하일 때 알려 드립니다.";
    return reply(`**${name}** 즐겨찾기 (${favorites.length}개)\n${target}`);
  }
  return reply("아직 지원하지 않는 명령입니다.");
}

async function settingsCommand(interaction, env, values) {
  const id = userIdOf(interaction);
  const user = await env.SITE.getUser(id);
  if (!user) {
    return consentPrompt();
  }

  const patch = {};
  if (values.묶어서받기 !== undefined) patch.digest = values.묶어서받기;
  if (values.일시정지 !== undefined) patch.paused = values.일시정지;
  if (values.조용한시간끄기) {
    patch.quiet = null;
  } else if (values.조용한시작 !== undefined || values.조용한끝 !== undefined) {
    if (values.조용한시작 === undefined || values.조용한끝 === undefined) {
      return reply("조용한 시간은 시작과 끝을 함께 입력해 주세요.");
    }
    if (values.조용한시작 === values.조용한끝) {
      return reply("시작과 끝이 같으면 조용한 시간이 없습니다.");
    }
    patch.quiet = { start: values.조용한시작, end: values.조용한끝 };
  }

  if (Object.keys(patch).length === 0) {
    return reply(`현재 설정: ${describeSettings(user.settings)}`);
  }
  const settings = await env.SITE.updateSettings(id, patch);
  return reply(`설정했습니다. ${describeSettings(settings)}`);
}

async function deleteCommand(interaction, env) {
  const user = await env.SITE.getUser(userIdOf(interaction));
  if (!user) {
    return reply("저장된 정보가 없습니다.");
  }
  return reply("설정, 구독, 즐겨찾기를 모두 삭제합니다. 되돌릴 수 없습니다.", {
    components: [row(button("me:delete", "모두 삭제", 4), button("me:cancel", "취소", 2))],
  });
}

export async function handleCommand(interaction, env, now = Date.now()) {
  const { path, values } = parseInteraction(interaction);
  if (path[0] !== "구마") {
    return reply("아직 지원하지 않는 명령입니다.");
  }
  try {
    switch (path[1]) {
      case "에린":
        return erinReply(now);
      case "시세":
        return marketReply(await env.SITE.marketSummary(String(values.아이템 ?? "")));
      case "알바":
        return await arbeitCommand(interaction, env, path[2], values);
      case "즐겨찾기":
        return await favoritesCommand(interaction, env, path[2], values);
      case "알림설정":
        return await settingsCommand(interaction, env, values);
      case "내정보":
        return path[2] === "삭제" ? await deleteCommand(interaction, env) : reply("아직 지원하지 않는 명령입니다.");
      default:
        return reply("아직 지원하지 않는 명령입니다.");
    }
  } catch (error) {
    // 사이트 Worker 가 사용자에게 보여도 되는 이유(한도, 잘못된 입력)를 던지면 그대로 알려 준다.
    const message = String(error?.message ?? "");
    return reply(/즐겨찾기|목표 가격|거래 기록|동의/.test(message) ? message : ERROR_TEXT);
  }
}

/** 버튼. 누른 사람 본인의 정보에만 적용한다. */
export async function handleComponent(interaction, env) {
  const id = userIdOf(interaction);
  const done = (content) => ({ type: UPDATE_MESSAGE, data: { content, components: [] } });
  try {
    switch (interaction?.data?.custom_id) {
      case "consent:agree":
        await env.SITE.registerUser(id, CONSENT_VERSION);
        return done("동의했습니다. `/구마 즐겨찾기 추가`나 `/구마 알바 추가`로 알림을 받을 대상을 고르세요.");
      case "me:delete":
        await env.SITE.deleteUser(id);
        return done("저장된 정보를 모두 삭제했습니다.");
      case "me:cancel":
        return done("취소했습니다.");
      default:
        return done("만료된 단추입니다. 명령을 다시 실행해 주세요.");
    }
  } catch {
    return done(ERROR_TEXT);
  }
}

const choices = (items) => ({
  type: AUTOCOMPLETE_RESULT,
  data: {
    choices: items
      .slice(0, 25)
      .map(({ name, value }) => ({ name: name.slice(0, 100), value: value.slice(0, 100) })),
  },
});

/** 자동완성. 실패해도 입력을 막지 않도록 빈 목록을 돌려준다. */
export async function handleAutocomplete(interaction, env) {
  const { path, focused } = parseInteraction(interaction);
  const query = String(focused?.value ?? "");
  try {
    if (path[1] === "시세" || (path[1] === "즐겨찾기" && path[2] === "추가")) {
      return choices((await env.SITE.searchItems(query)).map((name) => ({ name, value: name })));
    }
    if (path[1] === "즐겨찾기" && path[2] === "삭제") {
      const favorites = await env.SITE.listFavorites(userIdOf(interaction));
      return choices(
        favorites
          .filter((favorite) => favorite.name.includes(query))
          .map((favorite) => ({ name: favorite.name, value: favorite.name })),
      );
    }
    if (path[1] === "알바") {
      let entries = await env.SITE.searchArbeitEntries(query);
      if (path[2] === "삭제") {
        const user = await env.SITE.getUser(userIdOf(interaction));
        const subscribed = new Set(user?.arbeit ?? []);
        entries = entries.filter((entry) => subscribed.has(entry.id));
      }
      return choices(entries.map((entry) => ({ name: entry.label, value: entry.id })));
    }
  } catch {
    return choices([]);
  }
  return choices([]);
}

