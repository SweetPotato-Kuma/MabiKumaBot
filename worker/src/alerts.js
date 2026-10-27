import { createDmChannel, deleteMessage, isChannelGone, isDmBlocked, sendMessage } from "./discord.js";
import { msUntilShopReset } from "./erin.js";
import { arbeitMessages, searchAlertMessages } from "./format.js";

const WINDOW_MS = 60_000;
const CHUNK = 5;

/** 한 사람에게 메시지들을 보낸다. 저장해 둔 DM 채널이 없거나 사라졌으면 새로 만들어 SITE 에 기억시킨다. */
async function deliver(env, alert, messages) {
  let channelId = alert.dmChannelId;

  const open = async () => {
    const created = await createDmChannel(env, alert.discordUserId);
    if (!created.ok) {
      return created;
    }
    channelId = created.data.id;
    await env.SITE.updateSettings(alert.discordUserId, { dmChannelId: channelId });
    return created;
  };

  if (!channelId) {
    const opened = await open();
    if (!opened.ok) {
      return opened;
    }
  }

  let sent = 0;
  const ids = [];
  for (const content of messages) {
    let result = await sendMessage(env, channelId, content);
    if (isChannelGone(result)) {
      const reopened = await open();
      if (!reopened.ok) {
        return reopened;
      }
      result = await sendMessage(env, channelId, content);
    }
    if (!result.ok) {
      return result;
    }
    sent += 1;
    if (result.data?.id) ids.push(result.data.id);
  }
  return { ok: true, sent, channelId, ids };
}

/** 때가 지나면 지울 메시지를 사이트에 맡긴다. 실패해도 알림은 이미 갔으니 넘어간다. */
export async function scheduleCleanup(env, items) {
  if (items.length === 0) return;
  await Promise.resolve()
    .then(() => env.SITE.scheduleCleanup(items))
    .catch((error) => console.warn(JSON.stringify({ cleanup: `맡기지 못함: ${String(error?.message ?? error)}` })));
}

/**
 * 받는 사람마다 메시지를 만들어 보낸다. 보낼 수 없는 사람은 멈춰 두고 다음부터 보내지 않는다.
 * deleteAt 을 주면 보낸 메시지를 그 시각에 지우도록 맡긴다.
 */
async function sendAll(env, alerts, toMessages, deleteAt = null) {
  const summary = { users: alerts.length, sent: 0, failed: 0, stopped: 0 };
  const cleanup = [];

  for (let i = 0; i < alerts.length; i += CHUNK) {
    await Promise.all(
      alerts.slice(i, i + CHUNK).map(async (alert) => {
        try {
          const result = await deliver(env, alert, toMessages(alert));
          if (result.ok) {
            summary.sent += result.sent;
            if (deleteAt) result.ids.forEach((messageId) => cleanup.push({ channelId: result.channelId, messageId, deleteAt }));
          } else if (isDmBlocked(result)) {
            await env.SITE.markDmFailed(alert.discordUserId);
            summary.stopped += 1;
          } else {
            summary.failed += 1;
          }
        } catch {
          summary.failed += 1;
        }
      }),
    );
  }
  await scheduleCleanup(env, cleanup);
  return summary;
}

/**
 * 지난 1분(예약 시각 기준) 사이에 보고 가능해진 아르바이트를 구독자에게 DM 으로 알린다.
 * 알림은 그 에린 하루가 끝나는 에린 자정에 지운다. DM 에 지난 알림이 쌓이지 않게 한다.
 */
export async function runArbeitAlerts(env, scheduledTime) {
  const alerts = await env.SITE.dueArbeitAlerts(scheduledTime - WINDOW_MS, scheduledTime);
  return sendAll(env, alerts, arbeitMessages, scheduledTime + msUntilShopReset(scheduledTime));
}

/** 이 분에 확인할 저장 검색의 최저가가 목표 가격 이하가 된 사람에게 DM 으로 알린다. */
export async function runSearchAlerts(env, scheduledTime) {
  const alerts = await env.SITE.dueSearchAlerts(Math.floor(scheduledTime / WINDOW_MS));
  return sendAll(env, alerts, searchAlertMessages);
}
/**
 * 지울 때가 된 알림 메시지를 지운다. 이미 없거나(404) 지울 수 없는 곳(403)이면 다시 해도 소용없으니 끝난 것으로 친다.
 * 디스코드가 바쁘다고 하면(429 등) 남겨 두고 다음 분에 다시 한다.
 */
export async function runCleanups(env) {
  const due = await env.SITE.dueCleanups();
  if (due.length === 0) return null;
  const done = [];
  let failed = 0;
  for (let i = 0; i < due.length; i += CHUNK) {
    await Promise.all(
      due.slice(i, i + CHUNK).map(async (item) => {
        const result = await deleteMessage(env, item.channelId, item.messageId).catch(() => ({ ok: false, status: 0 }));
        if (result.ok || result.status === 403 || result.status === 404) done.push(item);
        else failed += 1;
      }),
    );
  }
  if (done.length > 0) await env.SITE.finishCleanups(done);
  return { due: due.length, deleted: done.length, failed };
}
