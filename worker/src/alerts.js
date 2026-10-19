import { createDmChannel, isChannelGone, isDmBlocked, sendMessage } from "./discord.js";
import { arbeitMessages, favoriteAlertMessages } from "./format.js";

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
  }
  return { ok: true, sent };
}

/** 받는 사람마다 메시지를 만들어 보낸다. 보낼 수 없는 사람은 멈춰 두고 다음부터 보내지 않는다. */
async function sendAll(env, alerts, toMessages) {
  const summary = { users: alerts.length, sent: 0, failed: 0, stopped: 0 };

  for (let i = 0; i < alerts.length; i += CHUNK) {
    await Promise.all(
      alerts.slice(i, i + CHUNK).map(async (alert) => {
        try {
          const result = await deliver(env, alert, toMessages(alert));
          if (result.ok) {
            summary.sent += result.sent;
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
  return summary;
}

/** 지난 1분(예약 시각 기준) 사이에 보고 가능해진 아르바이트를 구독자에게 DM 으로 알린다. */
export async function runArbeitAlerts(env, scheduledTime) {
  const alerts = await env.SITE.dueArbeitAlerts(scheduledTime - WINDOW_MS, scheduledTime);
  return sendAll(env, alerts, arbeitMessages);
}

/** 이 분에 확인할 즐겨찾기의 최저가가 목표 가격 이하가 된 사람에게 DM 으로 알린다. */
export async function runFavoriteAlerts(env, scheduledTime) {
  const alerts = await env.SITE.dueFavoriteAlerts(Math.floor(scheduledTime / WINDOW_MS));
  return sendAll(env, alerts, favoriteAlertMessages);
}
