/**
 * 봇 앱 이모지. 매일 알림의 어드밴스드 상자 구성품처럼 글 안에 작은 아이콘을 넣을 때 쓴다.
 * 앱 이모지는 그 앱만 쓸 수 있고(최대 2000개), 서버 권한 없이 DM 과 어느 서버에서든 보인다.
 * 테스트 봇과 운영 봇이 서로 다른 앱이라 각자 가진 토큰으로 자기 이모지를 만든다. 번호는 저장하지 않고 이름으로 찾는다.
 */

const API = "https://discord.com/api/v10";
const CACHE_MS = 60 * 60 * 1000;
const MAX_UPLOADS_PER_RUN = 6;
const NAME = /^[a-z0-9_]{2,32}$/;

let cache = null;

const headers = (env) => ({ authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" });

/** 이 앱의 이모지 이름 → 글에 넣는 표기(<:이름:번호>). 한 시간 동안 다시 읽지 않는다. 읽지 못하면 빈 표. */
export async function appEmojis(env, now = Date.now()) {
  if (cache && now - cache.at < CACHE_MS) return cache.map;
  const map = new Map();
  try {
    const response = await fetch(`${API}/applications/${env.DISCORD_APPLICATION_ID}/emojis`, { headers: headers(env) });
    if (response.ok) {
      const body = await response.json();
      for (const emoji of body.items ?? []) map.set(emoji.name, `<:${emoji.name}:${emoji.id}>`);
    }
  } catch {
    // 이모지를 못 읽어도 글자만으로 보낸다.
  }
  cache = { at: now, map };
  return map;
}

function toBase64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * 없는 이모지를 아이콘 주소로 만든다. items 는 { key, icon }. 한 번에 몇 개만 올리고 나머지는 다음 실행으로 미룬다.
 * 만든 개수를 돌려준다.
 */
export async function syncEmojis(env, items, now = Date.now()) {
  const existing = await appEmojis(env, now);
  const missing = items.filter((item) => item.icon && NAME.test(item.key) && !existing.has(item.key));
  let made = 0;
  for (const item of missing.slice(0, MAX_UPLOADS_PER_RUN)) {
    try {
      const image = await fetch(item.icon);
      if (!image.ok) continue;
      const type = image.headers.get("content-type")?.split(";")[0] || "image/webp";
      const bytes = new Uint8Array(await image.arrayBuffer());
      const response = await fetch(`${API}/applications/${env.DISCORD_APPLICATION_ID}/emojis`, {
        method: "POST",
        headers: headers(env),
        body: JSON.stringify({ name: item.key, image: `data:${type};base64,${toBase64(bytes)}` }),
      });
      if (response.ok) {
        const emoji = await response.json();
        existing.set(emoji.name, `<:${emoji.name}:${emoji.id}>`);
        made += 1;
      }
    } catch {
      // 다음 실행에서 다시 시도한다.
    }
  }
  return made;
}

/** 이모지 표기. 없으면 빈 글자라 글만 남는다. */
export const emojiOf = (map, key) => (map.get(key) ? `${map.get(key)} ` : "");

export const resetEmojisForTest = () => {
  cache = null;
};
