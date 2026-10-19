import { createDmChannel, isChannelGone, isDmBlocked, sendMessage } from "./discord.js";

const WINDOW_MS = 60_000;
const CHUNK = 5;

export function digestMessage(entries) {
  const lines = entries.map((entry) => `• ${entry.label}`).join("\n");
  return `**아르바이트 보고 가능**\n${lines}\n-# 알림 방식은 /구마 알바 설정 에서 바꿀 수 있습니다.`;
}

export function entryMessage(entry) {
  return `**${entry.label}** 아르바이트를 보고할 수 있습니다.`;
}

function messagesFor(alert) {
  return alert.digest ? [digestMessage(alert.entries)] : alert.entries.map(entryMessage);
}

/** 한 사람에게 보낸다. 저장해 둔 DM 채널이 없거나 사라졌으면 새로 만들어 SITE 에 기억시킨다. */
async function deliver(env, alert) {
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
  for (const content of messagesFor(alert)) {
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

/**
 * 지난 1분(예약 시각 기준) 사이에 보고 가능해진 아르바이트를 구독자에게 DM 으로 알린다.
 * 보낼 수 없는 사람은 멈춰 두고 다음부터 보내지 않는다.
 */
export async function runArbeitAlerts(env, scheduledTime) {
  const alerts = await env.SITE.dueArbeitAlerts(scheduledTime - WINDOW_MS, scheduledTime);
  const summary = { users: alerts.length, sent: 0, failed: 0, stopped: 0 };

  for (let i = 0; i < alerts.length; i += CHUNK) {
    await Promise.all(
      alerts.slice(i, i + CHUNK).map(async (alert) => {
        try {
          const result = await deliver(env, alert);
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
