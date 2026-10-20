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

/** 글 한 줄이나 {content, embeds, components} 를 보낸다. */
export function sendMessage(env, channelId, message) {
  const body = typeof message === "string" ? { content: message } : message;
  return call(env, `/channels/${channelId}/messages`, body);
}

/** 받는 사람이 DM 을 막았거나 서버를 함께 쓰지 않아 더 시도해도 소용없는 실패인지. */
export function isDmBlocked(result) {
  return !result.ok && (result.code === 50007 || result.code === 50278);
}

/** 저장해 둔 DM 채널이 사라진 경우. 새로 만들어 다시 보낸다. */
export function isChannelGone(result) {
  return !result.ok && (result.status === 404 || result.code === 10003);
}

/**
 * 처음 응답을 "처리 중"으로 보낸 상호작용의 메시지를 나중에 실제 내용으로 바꾼다.
 * 상호작용 토큰이 주소에 들어 있어 별도 인증이 필요 없다(15분 안에만 쓸 수 있다).
 */
export async function editOriginal(env, interaction, view) {
  const response = await fetch(
    `${API}/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: view.content ?? "",
        embeds: view.embeds ?? [],
        components: view.components ?? [],
      }),
    },
  );
  return response.ok;
}
