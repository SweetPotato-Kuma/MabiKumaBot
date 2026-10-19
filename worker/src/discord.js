const API = "https://discord.com/api/v10";
const MAX_RETRY_WAIT_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function call(env, path, body) {
  const request = () =>
    fetch(`${API}${path}`, {
      method: "POST",
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  let response = await request();
  if (response.status === 429) {
    const wait = Number((await response.json().catch(() => ({}))).retry_after) * 1000;
    if (Number.isFinite(wait) && wait <= MAX_RETRY_WAIT_MS) {
      await sleep(wait);
      response = await request();
    }
  }

  const data = await response.json().catch(() => ({}));
  return response.ok ? { ok: true, data } : { ok: false, status: response.status, code: data.code ?? null };
}

/** 사용자와의 DM 채널을 만든다. 이미 있으면 같은 채널을 돌려준다. */
export function createDmChannel(env, userId) {
  return call(env, "/users/@me/channels", { recipient_id: userId });
}

export function sendMessage(env, channelId, content) {
  return call(env, `/channels/${channelId}/messages`, { content });
}

/** 받는 사람이 DM 을 막았거나 서버를 함께 쓰지 않아 더 시도해도 소용없는 실패인지. */
export function isDmBlocked(result) {
  return !result.ok && (result.code === 50007 || result.code === 50278);
}

/** 저장해 둔 DM 채널이 사라진 경우. 새로 만들어 다시 보낸다. */
export function isChannelGone(result) {
  return !result.ok && (result.status === 404 || result.code === 10003);
}
