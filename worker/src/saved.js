import { EMPTY_QUERY, renderSearch, searchCard, stateOf, stateUrl } from "./search.js";
import {
  ACCENT,
  DANGER,
  PRIMARY,
  button,
  deferred,
  linkButton,
  menuButton,
  message,
  modal,
  newMessage,
  noticeView,
  parsePrice,
  row,
  select,
  update,
  userIdOf,
  view,
  won,
} from "./ui.js";
import { consentView } from "./views.js";

/** 저장한 검색(즐겨찾기) 화면. 저장 검색은 사이트 경매장과 같은 조건에 이름과 목표가를 더한 것이다. */

const MAX_SEARCHES = 20;

const summaryOf = (query) =>
  [
    query.keyword ? `"${query.keyword}"${query.exact ? " 정확히" : ""}` : "",
    query.category ? (query.category.startsWith("group:") ? `${query.category.slice(6)} 전체` : query.category) : "",
  ]
    .filter(Boolean)
    .join(" ");

/** 목록. 검색마다 최저가와 목표가를 한 줄로 보여 주고, 아래 선택 메뉴로 하나를 연다. */
export function savedListView(status) {
  const lines = status.searches.flatMap((search) => {
    const price = search.unavailable ? "읽지 못함" : search.lowest === null ? "매물 없음" : `최저 **${won(search.lowest)}**`;
    const target = search.targetPrice
      ? ` / 목표 ${won(search.targetPrice)}${search.lowest !== null && search.lowest <= search.targetPrice ? " 이하" : ""}`
      : "";
    const detail = [summaryOf(search.query), search.conditions.length > 0 ? `상세 조건 ${search.conditions.length}개` : ""]
      .filter(Boolean)
      .join(", ");
    return [`**${search.name}** ${price}${target}`, `　${detail}`];
  });
  const card = {
    title: "내 즐겨찾기",
    color: ACCENT,
    description:
      lines.length > 0 ? lines.join("\n").slice(0, 4000) : "저장한 검색이 없습니다. 새 검색에서 조건을 정한 뒤 즐겨찾기에 저장하세요.",
    footer: { text: `${status.searches.length}/${MAX_SEARCHES}` },
    timestamp: new Date(status.checkedAt).toISOString(),
  };
  return view(
    "",
    [
      status.searches.length > 0
        ? row(
            select(
              "f:open",
              "자세히 볼 검색",
              status.searches.map((search) => ({
                label: search.name,
                value: String(search.id),
                description: search.targetPrice ? `목표 ${won(search.targetPrice)}` : "목표가 없음",
              })),
            ),
          )
        : row(),
      row(
        button("f:new", "새 검색", PRIMARY),
        button("f:imp", "사이트에서 가져오기"),
        button("m:fav", "새로고침"),
        menuButton(),
      ),
    ],
    [card],
  );
}

/** 저장 검색 하나. 결과 카드 위에 목표가 상태를 한 줄 더하고 고치기 단추를 단다. */
export function savedDetailView(search, result, note = "") {
  const card = searchCard(result, { sid: search.id, title: search.name });
  const price = result.lowest;
  const target = search.targetPrice
    ? `목표 **${won(search.targetPrice)}**, ${price !== null && price <= search.targetPrice ? "지금 목표 이하입니다" : "아직 목표보다 비쌉니다"}`
    : "목표가가 없어 알림이 오지 않습니다.";
  card.description = `${target}\n\n${card.description}`.slice(0, 4000);
  return view(
    note,
    [
      row(
        button(`f:meta:${search.id}`, "이름·목표가", PRIMARY),
        button(`f:edit:${search.id}`, "조건 고치기"),
        button(`f:off:${search.id}`, "목표가 끄기", undefined, { disabled: !search.targetPrice }),
        button(`f:del:${search.id}`, "삭제", DANGER),
      ),
      row(button("q:share", "채널에 공유"), button(`f:show:${search.id}`, "새로고침"), button("f:list", "← 목록"), menuButton()),
      row(linkButton("사이트에서 보기", stateUrl(result.query))),
    ],
    [card],
  );
}

async function detail(env, uid, id, note) {
  const { search, result } = await env.SITE.searchDetail(uid, Number(id), { limit: 8 });
  return savedDetailView(search, result, note);
}

export async function savedList(env, uid) {
  return savedListView(await env.SITE.searchesStatus(uid));
}

async function findSaved(env, uid, id) {
  return (await env.SITE.listSearches(uid)).find((search) => search.id === Number(id)) ?? null;
}

function importView(result) {
  const lines = [
    result.added.length > 0 ? `**사이트 즐겨찾기 ${result.added.length}개를 가져왔습니다.**` : "**가져온 즐겨찾기가 없습니다.**",
    ...result.added.slice(0, 10).map((name) => `• ${name}`),
  ];
  if (result.existing > 0) lines.push(`이미 있는 검색 ${result.existing}개`);
  if (result.invalid > 0) lines.push(`조건이 빈 검색 ${result.invalid}개는 건너뜀`);
  if (result.full > 0) lines.push(`즐겨찾기가 가득 차 ${result.full}개는 가져오지 못했습니다.`);
  return view(lines.join("\n"), [row(button("m:fav", "즐겨찾기 열기", PRIMARY), menuButton())]);
}

/** 저장 검색 화면의 단추와 선택 메뉴(f:). */
export async function savedComponent(env, interaction, act, rest, values) {
  const uid = userIdOf(interaction);
  const id = rest || values[0];
  switch (act) {
    case "open":
    case "show":
      return deferred("update", () => detail(env, uid, id));
    case "list":
      return deferred("update", () => savedList(env, uid));
    case "new":
      return deferred("update", () => renderSearch(env, EMPTY_QUERY));
    case "edit": {
      const saved = await findSaved(env, uid, id);
      if (!saved) return message("저장한 검색을 찾지 못했습니다.");
      return deferred("update", () => renderSearch(env, saved.query, { sid: saved.id, title: `${saved.name} 고치는 중` }));
    }
    case "meta": {
      const saved = await findSaved(env, uid, id);
      if (!saved) return message("저장한 검색을 찾지 못했습니다.");
      return modal(`f:metam:${saved.id}`, "이름과 목표가", [
        { id: "name", label: "이름", max: 30, value: saved.name },
        { id: "target", label: "목표가 (개당, 비우면 알림 끔)", required: false, max: 14, value: saved.targetPrice ? String(saved.targetPrice) : "", placeholder: "예: 4300" },
      ]);
    }
    case "off": {
      const saved = await findSaved(env, uid, id);
      if (!saved) return message("저장한 검색을 찾지 못했습니다.");
      await env.SITE.saveSearch(uid, { id: saved.id, ...saved.query, targetPrice: 0 });
      return deferred("update", () => detail(env, uid, saved.id, "목표가를 껐습니다."));
    }
    case "del": {
      const saved = await findSaved(env, uid, id);
      if (!saved) return message("저장한 검색을 찾지 못했습니다.");
      return update(
        view(`**${saved.name}** 검색을 지울까요?`, [row(button(`f:delok:${saved.id}`, "삭제", DANGER), button(`f:show:${saved.id}`, "취소"))]),
      );
    }
    case "delok":
      await env.SITE.removeSearch(uid, Number(id));
      return deferred("update", () => savedList(env, uid));
    case "imp": {
      if (!(await env.SITE.getUser(uid))) return update(consentView("fav"));
      if (!(await env.SITE.linkStatus(uid)).linked) {
        return newMessage(
          noticeView("사이트 계정을 먼저 연결해 주세요. 연결 코드를 받아 사이트 프로필에 입력하면 됩니다.", button("me:link", "연결 코드 받기", PRIMARY)),
        );
      }
      return deferred("update", async () => importView(await env.SITE.importSiteSearches(uid)));
    }
    default:
      return null;
  }
}

/** 검색 화면의 저장 단추. 고치는 중이면 그 검색의 이름과 목표가를, 아니면 검색어나 분류를 이름으로 채운다. */
export async function saveFromSearch(env, interaction) {
  const uid = userIdOf(interaction);
  if (!(await env.SITE.getUser(uid))) return newMessage(consentView("fav"));
  const { query, sid } = stateOf(interaction);
  const saved = sid ? await findSaved(env, uid, sid) : null;
  const name = saved?.name ?? (query.keyword || (query.category.startsWith("group:") ? query.category.slice(6) : query.category));
  return modal(saved ? `f:savem:${saved.id}` : "f:savem", saved ? "저장 검색 고치기" : "즐겨찾기에 저장", [
    { id: "name", label: "이름", max: 30, value: name },
    {
      id: "target",
      label: "목표가 (개당, 이하면 DM 알림)",
      required: false,
      max: 14,
      value: saved?.targetPrice ? String(saved.targetPrice) : "",
      placeholder: "예: 4300",
    },
  ]);
}

/** 저장 검색 화면의 입력창 제출(f:savem, f:metam). */
export async function savedModal(env, interaction, act, rest, fields) {
  const uid = userIdOf(interaction);
  const target = parsePrice(fields.target);
  if (target === null) return message("목표가는 숫자로 입력해 주세요.");
  const name = String(fields.name ?? "").trim();
  const { query } = stateOf(interaction);

  if (act === "savem") {
    const id = rest ? Number(rest) : undefined;
    return deferred("update", async () => {
      const { search, created } = await env.SITE.saveSearch(uid, { ...(id ? { id } : {}), ...query, name, targetPrice: target ?? 0 });
      const note = id ? "고쳤습니다." : created ? "즐겨찾기에 저장했습니다." : `같은 조건이 "${search.name}" 이름으로 이미 저장돼 있습니다.`;
      return detail(env, uid, search.id, note);
    });
  }
  if (act === "metam") {
    const saved = await findSaved(env, uid, rest);
    if (!saved) return message("저장한 검색을 찾지 못했습니다.");
    return deferred("update", async () => {
      await env.SITE.saveSearch(uid, { id: saved.id, ...saved.query, name, targetPrice: target ?? 0 });
      return detail(env, uid, saved.id, "고쳤습니다.");
    });
  }
  return null;
}

