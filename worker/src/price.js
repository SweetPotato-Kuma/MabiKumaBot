import {
  ACCENT,
  PRIMARY,
  button,
  deferred,
  fitsId,
  linkButton,
  menuButton,
  modal,
  noticeView,
  row,
  select,
  update,
  userIdOf,
  view,
  won,
} from "./ui.js";

/**
 * 시세 보기. 아이템 하나의 최저가, 24시간 거래, 7일 등락과 7일 차트 그림을 카드 한 장으로 보여 준다.
 * 그림은 사이트 Worker 가 그린 PNG(캔들 또는 선)이고, 고른 모양은 동의한 사용자의 설정에 기억한다.
 * 상세 검색은 봇에서 하지 않고 사이트 경매장으로 보낸다.
 */

const STYLES = ["candle", "line"];
const FOOTER = { candle: "최근 7일 4시간 봉", line: "최근 7일 시간별 중위가" };
const TOGGLE = { candle: "캔들로 보기", line: "선으로 보기" };
const SEP = ":";

export const priceModal = () =>
  modal("p:m", "시세 보기", [{ id: "name", label: "아이템 이름", max: 80, placeholder: "예: 낙지" }]);

const styleOf = (value) => (STYLES.includes(value) ? value : "candle");
const otherStyle = (style) => (style === "candle" ? "line" : "candle");

/** 시세 카드. 제목 줄 앞에 아이콘을 작게 붙이고, 아래에 고른 모양의 차트 그림을 붙인다. */
export function priceView(card, style) {
  const lines = [];
  lines.push(
    card.lowest?.price != null
      ? `최저가 **${won(card.lowest.price)}** · 매물 ${won(card.lowest.listings)}개`
      : "지금 올라온 매물이 없습니다.",
  );
  if (card.day) lines.push(`24시간 거래 ${won(card.day.n)}건, 중위가 **${won(card.day.mid)}**`);
  if (card.change) {
    const { percent, from, to } = card.change;
    lines.push(`7일 ${percent >= 0 ? "▲" : "▼"} ${Math.abs(percent)}% (${won(from)} → ${won(to)})`);
  }
  const embed = {
    author: { name: card.name.slice(0, 256), url: card.links.item, ...(card.icon ? { icon_url: card.icon } : {}) },
    color: ACCENT,
    description: lines.join("\n"),
    image: { url: card.charts[style] },
    footer: { text: FOOTER[style] },
    timestamp: new Date().toISOString(),
  };
  const toggle = `p:s${SEP}${otherStyle(style)}${SEP}${card.name}`;
  const refresh = `p:r${SEP}${style}${SEP}${card.name}`;
  return view("", [
    row(
      fitsId(toggle) ? button(toggle, TOGGLE[otherStyle(style)], PRIMARY) : null,
      fitsId(refresh) ? button(refresh, "새로고침") : null,
      linkButton("사이트에서 보기", card.links.item),
      menuButton(),
    ),
  ], [embed]);
}

/** 이름이 정확히 맞는 기록이 없을 때. 그 글자로 시작하는 아이템을 고르게 한다. */
function pickView(name, names) {
  if (names.length === 0) {
    return noticeView(`**${name}** 거래 기록을 찾지 못했습니다.`, button("p:ask", "다시 입력", PRIMARY));
  }
  return view(`**${name}** 로 찾은 아이템`, [
    row(select("p:pick", "아이템 고르기", names.slice(0, 25).map((each) => ({ label: each, value: each })))),
    row(button("p:ask", "다시 입력"), menuButton()),
  ]);
}

async function chartStyle(env, uid) {
  const user = await env.SITE.getUser(uid).catch(() => null);
  return styleOf(user?.settings?.chartStyle);
}

/** 이름으로 시세 카드를 만든다. 기록이 없으면 비슷한 이름을 고르게 한다. */
export async function openPrice(env, uid, rawName, style) {
  const name = String(rawName ?? "").trim();
  const card = name ? await env.SITE.priceCard(name) : null;
  if (card) return priceView(card, style ?? (await chartStyle(env, uid)));
  const names = name ? (await env.SITE.searchItems(name).catch(() => [])).filter((each) => each !== name) : [];
  return pickView(name, names);
}

/** 시세 화면의 단추와 선택 메뉴(p:). */
export async function priceComponent(env, interaction, act, rest, values) {
  const uid = userIdOf(interaction);
  if (act === "ask") return priceModal();
  if (act === "pick") return deferred("update", () => openPrice(env, uid, values[0]));
  if (act === "s" || act === "r") {
    const at = rest.indexOf(SEP);
    if (at < 0) return null;
    const style = styleOf(rest.slice(0, at));
    const name = rest.slice(at + 1);
    if (act === "s" && (await env.SITE.getUser(uid).catch(() => null))) {
      await env.SITE.updateSettings(uid, { chartStyle: style }).catch(() => null);
    }
    return deferred("update", () => openPrice(env, uid, name, style));
  }
  return null;
}

/** 시세 입력창 제출(p:m). */
export function priceModalSubmit(env, interaction, fields) {
  const uid = userIdOf(interaction);
  const name = String(fields.name ?? "").trim();
  if (!name) return update(pickView("", []));
  return deferred(interaction.message ? "update" : "new", () => openPrice(env, uid, name));
}
