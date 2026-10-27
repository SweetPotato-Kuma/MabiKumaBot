import { createDmChannel, isChannelGone, isDmBlocked, sendMessage } from "./discord.js";
import { appEmojis, emojiOf, syncEmojis } from "./emojis.js";
import { scheduleCleanup } from "./alerts.js";
import {
  ACCENT,
  PRIMARY,
  SECONDARY,
  SUCCESS,
  button,
  menuButton,
  newMessage,
  noticeView,
  row,
  select,
  update,
  userIdOf,
  view,
} from "./ui.js";

/**
 * 매일 알림: 오늘의 요일 보너스와 어드밴스드 상자. 카드는 사이트 Worker 가 만들고(SITE.dailyCard), 여기서는 그리고 보낸다.
 * 개인은 정한 시각에 DM, 서버는 관리자가 정한 채널과 시각에 카드 한 장이다. 기본 시각은 상자가 바뀌는 오전 7시다.
 */

export const DEFAULT_HOUR = 7;
/** 오늘 상자를 자정 전에 한 번 더 알리는 시각(한국 시각, 고정). 사이트의 REMIND_HOUR 와 같다. */
export const REMIND_HOUR = 23;
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;
const TEXT_CHANNELS = [0, 5];

export const hourLabel = (hour) => (hour === 0 ? "자정" : hour < 12 ? `오전 ${hour}시` : hour === 12 ? "낮 12시" : `오후 ${hour - 12}시`);

/** 카드 한 장. 버튼은 요일 보너스 보기와 (개인 DM 이 아닐 때) 알림 설정이다. */
export function dailyView(card, emojis, { footer, channel = false } = {}) {
  const sameDay = card.box.day === card.day;
  const lines = [
    "**요일 보너스** (자정부터)",
    ...card.bonuses.map((bonus) => `• ${bonus}`),
    "",
    `**어드밴스드 상자** (${sameDay ? `오전 ${card.box.fromHour}시부터` : `오전 ${card.box.fromHour}시까지 ${card.box.day}요일 상자`})`,
    ...card.box.items.map((item) => `${emojiOf(emojis, item.key)}${item.name} ${item.count}개`),
    "",
    `-# 내일(${card.tomorrow.day}) ${card.tomorrow.celtic}: ${card.tomorrow.short}`,
  ];
  return view(
    "",
    [row(button("d:bonus", "요일 보너스 보기"), channel ? button("d:set", "내 매일 알림") : null)],
    [
      {
        author: { name: `${card.date} ${card.day}요일 · ${card.celtic}` },
        color: ACCENT,
        description: lines.join("\n"),
        ...(footer ? { footer: { text: footer } } : {}),
      },
    ],
  );
}

/** 자정 전 알림: 오늘 상자를 한 번 더. 자정에 지운다. */
export function reminderView(card, emojis) {
  return view("", [], [
    {
      author: { name: "오늘 상자는 자정까지" },
      color: ACCENT,
      description: card.box.items.map((item) => `${emojiOf(emojis, item.key)}${item.name} ${item.count}개`).join("\n"),
    },
  ]);
}

/** 요일 보너스 보기: 일주일치 요일 보너스만. */
export function bonusView(card) {
  return view("", [], [
    {
      author: { name: "요일 보너스" },
      color: ACCENT,
      description: [
        ...card.week.map((each) => `**${each.day} ${each.celtic}** ${each.short}`),
        "",
        `-# 오늘은 ${card.day}요일(${card.celtic}). 요일은 현실 시각 자정에 바뀝니다.`,
      ].join("\n"),
    },
  ]);
}

const hourOptions = (selected) =>
  Array.from({ length: 24 }, (_, hour) => ({
    label: hourLabel(hour),
    value: String(hour),
    ...(hour === DEFAULT_HOUR ? { description: "어드밴스드 상자가 바뀌는 시각" } : {}),
    default: hour === selected,
  }));

/**
 * 개인 매일 알림 설정. 꺼져 있으면 켜기 단추(오전 7시), 켜져 있으면 시각 고르기, 자정 전 알림 켜고 끄기, 끄기.
 * 자정 전 알림은 매일 알림을 켜면 함께 켜져 있다(설정 dailyRemind 기본값 true).
 */
export function dailySettingsView(settings) {
  const on = Number.isInteger(settings.daily);
  const remind = settings.dailyRemind !== false;
  const state = on ? `${hourLabel(settings.daily)}에 DM${remind ? ` · 자정 전 알림 ${hourLabel(REMIND_HOUR)}` : ""}` : "꺼짐";
  return view(
    `**매일 알림** ${state}\n-# 요일 보너스는 자정, 어드밴스드 상자는 오전 7시에 바뀝니다.`,
    [
      on ? row(select("s:dailyh", "받을 시각", hourOptions(settings.daily))) : row(),
      row(
        on ? button("s:dailyr", remind ? "자정 전 알림: 켜짐" : "자정 전 알림: 꺼짐", remind ? SUCCESS : SECONDARY) : null,
        on ? button("s:dailyoff", "끄기") : button("s:dailyon", `${hourLabel(DEFAULT_HOUR)}에 받기`, PRIMARY),
        button("d:preview", "지금 미리 보기"),
      ),
      row(button("m:set", "← 알림 설정"), menuButton()),
    ],
  );
}

const KST_OFFSET_MS = 9 * 3600 * 1000;

// ---------- 서버 설정 ----------
/** 이 상호작용을 한 사람이 서버 관리 권한을 가졌는지. 서버에 설치된 봇에서만 서버 설정을 연다. */
export function isGuildAdmin(interaction) {
  if (!interaction?.guild_id || !interaction?.member?.permissions) return false;
  if (interaction.authorizing_integration_owners && !("0" in interaction.authorizing_integration_owners)) return false;
  const permissions = BigInt(interaction.member.permissions);
  return (permissions & MANAGE_GUILD) !== 0n || (permissions & ADMINISTRATOR) !== 0n;
}

export function guildSettingsView(guild, note = "") {
  const { dailyChannelId: channel, dailyHour: hour } = guild.settings;
  return view(
    [
      `**서버 설정** ${channel ? `<#${channel}> 에 ${hourLabel(hour)} · 자정 전 알림 ${hourLabel(REMIND_HOUR)}` : "매일 알림 꺼짐"}`,
      "-# 서버 관리자에게만 보입니다. 고른 채널에 매일 요일 보너스와 어드밴스드 상자 카드를 올립니다.",
      ...(note ? [note] : []),
    ].join("\n"),
    [
      row({
        type: 8,
        custom_id: "g:ch",
        placeholder: "올릴 채널",
        channel_types: TEXT_CHANNELS,
        min_values: 1,
        max_values: 1,
        ...(channel ? { default_values: [{ id: channel, type: "channel" }] } : {}),
      }),
      channel ? row(select("g:hr", "올릴 시각", hourOptions(hour))) : row(),
      row(
        channel ? button("g:test", "지금 한 번 올려 보기", PRIMARY) : null,
        channel ? button("g:off", "끄기", SECONDARY) : null,
        menuButton(),
      ),
    ],
  );
}

/** 서버 채널에 카드를 올린다. 쓸 수 없으면(권한 없음, 채널 없음) 실패를 돌려준다. */
async function postToChannel(env, channelId, card, hour) {
  const emojis = await appEmojis(env);
  const body = dailyView(card, emojis, { footer: `매일 ${hourLabel(hour)} 알림`, channel: true });
  return sendMessage(env, channelId, { embeds: body.embeds, components: body.components });
}

/** at 뒤에 처음 오는 한국 시각 hour 시 정각. */
export function nextKstHour(at, hour) {
  const kst = new Date(at + KST_OFFSET_MS);
  let next = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), hour) - KST_OFFSET_MS;
  if (next <= at) next += 24 * 3600 * 1000;
  return next;
}

const cannotWrite = (result) => !result.ok && [403, 404].includes(result.status);

/** 서버 설정 화면의 메뉴와 단추(g:). 모든 동작 전에 관리자인지 다시 확인한다. */
export async function guildComponent(env, interaction, act, values) {
  if (!isGuildAdmin(interaction)) return newMessage(noticeView("서버 관리 권한이 있는 사람만 서버 설정을 바꿀 수 있습니다."));
  const guildId = interaction.guild_id;
  switch (act) {
    case "open":
      return update(guildSettingsView(await env.SITE.getGuild(guildId)));
    case "ch": {
      const current = await env.SITE.getGuild(guildId);
      const hour = current.settings.dailyHour ?? DEFAULT_HOUR;
      return update(guildSettingsView(await env.SITE.updateGuildSettings(guildId, { dailyChannelId: values[0], dailyHour: hour })));
    }
    case "hr":
      return update(guildSettingsView(await env.SITE.updateGuildSettings(guildId, { dailyHour: Number(values[0]) })));
    case "off":
      return update(guildSettingsView(await env.SITE.stopGuildDaily(guildId), "매일 알림을 껐습니다."));
    case "test": {
      const guild = await env.SITE.getGuild(guildId);
      if (!guild.settings.dailyChannelId) return update(guildSettingsView(guild));
      const result = await postToChannel(env, guild.settings.dailyChannelId, await env.SITE.dailyCard(), guild.settings.dailyHour);
      const note = result.ok
        ? "채널에 올렸습니다."
        : cannotWrite(result)
          ? "봇이 그 채널에 글을 쓸 수 없습니다. 채널 권한에서 봇의 메시지 보내기를 허용해 주세요."
          : "올리지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
      return update(guildSettingsView(guild, note));
    }
    default:
      return null;
  }
}

/** 매일 알림 카드의 단추와 미리 보기(d:). 채널에 올라간 카드에서도 누른 사람에게만 보인다. */
export async function dailyComponent(env, interaction, act) {
  if (act === "bonus") return newMessage(bonusView(await env.SITE.dailyCard()));
  if (act === "preview") {
    const emojis = await appEmojis(env);
    return newMessage(dailyView(await env.SITE.dailyCard(), emojis));
  }
  if (act === "set") {
    const user = await env.SITE.getUser(userIdOf(interaction));
    if (!user) return newMessage(noticeView("개인 매일 알림은 /마비쿠마 에서 동의한 뒤 켤 수 있습니다."));
    return newMessage(dailySettingsView(user.settings));
  }
  return null;
}

// ---------- 정한 시각에 보내기 ----------

async function deliverDm(env, user, message) {
  let channelId = user.dmChannelId;
  if (!channelId) {
    const created = await createDmChannel(env, user.discordUserId);
    if (!created.ok) return created;
    channelId = created.data.id;
    await env.SITE.updateSettings(user.discordUserId, { dmChannelId: channelId });
  }
  let result = await sendMessage(env, channelId, message);
  if (isChannelGone(result)) {
    const created = await createDmChannel(env, user.discordUserId);
    if (!created.ok) return created;
    await env.SITE.updateSettings(user.discordUserId, { dmChannelId: created.data.id });
    channelId = created.data.id;
    result = await sendMessage(env, channelId, message);
  }
  return { ...result, channelId };
}

/**
 * 받을 사람(DM)과 서버 채널에 같은 카드를 보내고, 보낸 메시지는 deleteAt 에 지우도록 맡긴다.
 * DM 을 막은 사람은 알림을 멈추고, 봇이 쓸 수 없는 서버 채널은 그 서버의 매일 알림을 끈다.
 */
async function deliverAll(env, due, dm, toChannel, deleteAt) {
  const summary = { users: due.users.length, guilds: due.guilds.length, sent: 0, failed: 0, stopped: 0 };
  const cleanup = [];
  const keep = (channelId, result) => {
    if (result.data?.id) cleanup.push({ channelId, messageId: result.data.id, deleteAt });
  };
  for (const user of due.users) {
    const result = await deliverDm(env, user, dm).catch(() => ({ ok: false }));
    if (result.ok) {
      summary.sent += 1;
      keep(result.channelId, result);
    } else if (isDmBlocked(result)) {
      await env.SITE.markDmFailed(user.discordUserId);
      summary.stopped += 1;
    } else summary.failed += 1;
  }
  for (const guild of due.guilds) {
    const result = await toChannel(guild).catch(() => ({ ok: false }));
    if (result.ok) {
      summary.sent += 1;
      keep(guild.channelId, result);
    } else if (cannotWrite(result)) {
      await env.SITE.stopGuildDaily(guild.guildId);
      summary.stopped += 1;
    } else summary.failed += 1;
  }
  await scheduleCleanup(env, cleanup);
  return summary;
}

/**
 * 한국 시각 정각(분 0)에만 돈다. 그 시에 받을 사람과 서버를 사이트에서 받아 카드를 보낸다.
 * 카드는 상자가 바뀌는 다음 오전 7시에 지운다. 오후 11시에는 자정 전 알림을 보내고 자정에 지운다.
 * 이모지가 아직 없는 구성품은 먼저 만들어 둔다(봇마다 자기 앱에 만든다).
 */
export async function runDailyAlerts(env, scheduledTime) {
  const kst = new Date(scheduledTime + KST_OFFSET_MS);
  if (kst.getUTCMinutes() !== 0) return null;
  const hour = kst.getUTCHours();
  const due = await env.SITE.dueDailyDigests(hour);
  let summary = { users: due.users.length, guilds: due.guilds.length, sent: 0, failed: 0, stopped: 0 };
  if (due.card) {
    await syncEmojis(env, due.card.box.items);
    const emojis = await appEmojis(env);
    const personal = dailyView(due.card, emojis, { footer: `매일 ${hourLabel(hour)} 알림` });
    const dm = { embeds: personal.embeds, components: personal.components };
    summary = await deliverAll(
      env,
      due,
      dm,
      (guild) => postToChannel(env, guild.channelId, due.card, hour),
      nextKstHour(scheduledTime, DEFAULT_HOUR),
    );
  }
  if (hour !== REMIND_HOUR) return summary;

  const remind = await env.SITE.dueDailyReminders();
  if (!remind.card) return { ...summary, reminders: { users: 0, guilds: 0, sent: 0, failed: 0, stopped: 0 } };
  await syncEmojis(env, remind.card.box.items);
  const body = reminderView(remind.card, await appEmojis(env));
  const message = { embeds: body.embeds };
  const reminders = await deliverAll(
    env,
    remind,
    message,
    (guild) => sendMessage(env, guild.channelId, message),
    nextKstHour(scheduledTime, 0),
  );
  return { ...summary, reminders };
}
