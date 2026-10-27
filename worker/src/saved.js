import {
  ACCENT,
  DANGER,
  PRIMARY,
  button,
  deferred,
  linkButton,
  menuButton,
  message,
  row,
  select,
  update,
  userIdOf,
  view,
  won,
} from "./ui.js";

/**
 * 즐겨찾기 알림 화면. 사이트 경매장 즐겨찾기의 종 단추로 등록한 검색을 보고, 새 매물 알림을 켜고 끄고, 지운다.
 * 검색 조건을 정하거나 고치는 일은 사이트에서 한다(봇에서 조건을 고르는 화면은 2026-10 에 뺐다).
 */

const MAX_SEARCHES = 20;
const PAGE_SIZE = 10;
const REGISTER_URL = "https://mabi.spkuma.com/auction?ref=bot";

const summaryOf = (query, conditions) =>
  [
    query.keyword ? `"${query.keyword}"${query.exact ? " 정확히" : ""}` : "",
    query.category ? (query.category.startsWith("group:") ? `${query.category.slice(6)} 전체` : query.category) : "",
    ...conditions,
  ]
    .filter(Boolean)
    .join(", ");

const priceLine = (search) =>
  search.unavailable
    ? "지금 읽지 못했습니다."
    : search.lowest === null
      ? "매물 없음"
      : `최저 **${won(search.lowest)}** · 매물 ${won(search.total)}개`;

const author = (search) => ({
  name: search.name.slice(0, 256),
  url: search.url,
  ...(search.icon ? { icon_url: search.icon } : {}),
});

/** 목록. 검색마다 작은 카드 한 장(아이콘, 최저가, 조건, 알림 상태)이고 한 쪽에 10개씩이다. */
export function savedListView(status, page = 0) {
  const total = status.searches.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const shown = status.searches.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const cards = shown.map((search) => ({
    author: author(search),
    color: ACCENT,
    description: [
      priceLine(search),
      `-# ${summaryOf(search.query, search.conditions)} · 새 매물 알림 ${search.alertOn ? "켜짐" : "꺼짐"}`,
    ].join("\n"),
  }));
  const content =
    total > 0
      ? `**즐겨찾기 알림** ${total}/${MAX_SEARCHES}`
      : "**즐겨찾기 알림**\n등록한 검색이 없습니다. 사이트 경매장 즐겨찾기의 종 단추로 등록하세요.";
  return view(
    content,
    [
      total > 0
        ? row(
            select(
              "f:open",
              "자세히 볼 검색",
              status.searches.map((search) => ({
                label: search.name,
                value: String(search.id),
                description: `새 매물 알림 ${search.alertOn ? "켜짐" : "꺼짐"}`,
              })),
            ),
          )
        : row(),
      row(
        ...(pages > 1
          ? [
              button(`f:pg:${current - 1}`, "← 이전", undefined, { disabled: current === 0 }),
              button(`f:pg:${current + 1}`, "다음 →", undefined, { disabled: current === pages - 1 }),
            ]
          : []),
        button(`f:pg:${current}`, "새로고침"),
        linkButton("사이트에서 등록하기", REGISTER_URL),
        menuButton(),
      ),
    ],
    cards,
  );
}

/** 검색 하나. 조건, 지금 최저가와 매물 몇 개, 알림 켜기/끄기, 지우기, 사이트에서 열기. */
export function savedDetailView(search, result, note = "") {
  const lines = [];
  if (search.query.keyword) lines.push(`검색어 **${search.query.keyword}**${search.query.exact ? " (정확히 일치)" : ""}`);
  if (search.query.category) {
    const category = search.query.category;
    lines.push(`분류 **${category.startsWith("group:") ? `${category.slice(6)} 전체` : category}**`);
  }
  if (search.conditions.length > 0) lines.push("상세 조건", ...search.conditions.map((each) => `• ${each}`));
  lines.push("", priceLine({ ...result, unavailable: false }));
  result.items.slice(0, 3).forEach((item, index) => {
    const count = item.count > 1 ? ` ×${won(item.count)}` : "";
    lines.push(`**${index + 1}.** ${won(item.price)} ${item.name}${count}`);
    if (item.notes?.length > 0) lines.push(`　${item.notes.join(" / ")}`);
  });
  const card = {
    author: author({ ...search, icon: result.icon }),
    color: ACCENT,
    description: lines.join("\n").slice(0, 4000),
    footer: { text: `새 매물 알림 ${search.alertOn ? "켜짐" : "꺼짐"}` },
    ...(result.checkedAt ? { timestamp: new Date(result.checkedAt).toISOString() } : {}),
  };
  return view(
    note,
    [
      row(
        button(`f:al:${search.id}:${search.alertOn ? 0 : 1}`, search.alertOn ? "새 매물 알림 끄기" : "새 매물 알림 켜기", search.alertOn ? undefined : PRIMARY),
        button(`f:del:${search.id}`, "삭제", DANGER),
        linkButton("사이트에서 열기", search.url),
        button("f:pg:0", "← 목록"),
        menuButton(),
      ),
    ],
    [card],
  );
}

async function detail(env, uid, id, note) {
  const { search, result } = await env.SITE.searchDetail(uid, Number(id), { limit: 3 });
  return savedDetailView(search, result, note);
}

export async function savedList(env, uid, page = 0) {
  return savedListView(await env.SITE.searchesStatus(uid), page);
}

async function findSaved(env, uid, id) {
  return (await env.SITE.listSearches(uid)).find((search) => search.id === Number(id)) ?? null;
}

/**
 * 즐겨찾기 알림 화면의 단추와 선택 메뉴(f:).
 * 예전 화면의 단추(새 검색, 사이트에서 가져오기, 조건·목표가 고치기)는 만료로 안내한다.
 */
export async function savedComponent(env, interaction, act, rest, values) {
  const uid = userIdOf(interaction);
  switch (act) {
    case "open":
    case "show":
      return deferred("update", () => detail(env, uid, rest || values[0]));
    case "list":
      return deferred("update", () => savedList(env, uid));
    case "pg":
      return deferred("update", () => savedList(env, uid, Number(rest)));
    case "al": {
      const [id, on] = rest.split(":");
      await env.SITE.setSearchAlert(uid, Number(id), on === "1");
      return deferred("update", () =>
        detail(env, uid, id, on === "1" ? "새 매물 알림을 켰습니다." : "새 매물 알림을 껐습니다."),
      );
    }
    case "del": {
      const saved = await findSaved(env, uid, rest);
      if (!saved) return message("저장한 검색을 찾지 못했습니다.");
      return update(
        view(`**${saved.name}** 검색을 지울까요?`, [
          row(button(`f:delok:${saved.id}`, "삭제", DANGER), button(`f:show:${saved.id}`, "취소")),
        ]),
      );
    }
    case "delok":
      await env.SITE.removeSearch(uid, Number(rest));
      return deferred("update", () => savedList(env, uid));
    default:
      return null;
  }
}
