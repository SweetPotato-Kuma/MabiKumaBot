import {
  ACCENT,
  PRIMARY,
  SUCCESS,
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
  view,
  won,
} from "./ui.js";

/**
 * 경매장 검색 화면. 검색 조건은 결과 카드 제목의 링크(사이트 경매장 주소)에 담겨 메시지와 함께 다닌다.
 * 그래서 단추를 누를 때마다 그 주소에서 조건을 읽고, 바꾼 조건으로 다시 검색해 같은 메시지를 고친다.
 * 사이트의 주소 형식(keyword, category, f, exact)을 그대로 써서 링크를 누르면 사이트에서 같은 검색이 열린다.
 */

const SITE_AUCTION = "https://mabi.spkuma.com/auction";
export const EMPTY_QUERY = { keyword: "", category: "", filterKey: "", exact: false };
const ANY = "*";
const SEP = "|";
const PAIR = "\u001f";
const RESULT_LIMIT = 8;

// ---------- 상태 ----------
export function stateUrl(query, sid) {
  const params = new URLSearchParams();
  if (query.keyword) params.set("keyword", query.keyword);
  if (query.category) params.set("category", query.category);
  if (query.filterKey) params.set("f", query.filterKey);
  if (query.exact) params.set("exact", "1");
  if (sid) params.set("sid", String(sid));
  params.set("ref", "bot");
  return `${SITE_AUCTION}?${params}`;
}

/** 단추가 달린 메시지의 결과 카드에서 검색 조건과 고치는 중인 저장 검색 번호를 읽는다. */
export function stateOf(interaction) {
  const url = interaction?.message?.embeds?.[0]?.url;
  try {
    const params = new URL(url).searchParams;
    const sid = Number(params.get("sid"));
    return {
      query: {
        keyword: params.get("keyword") ?? "",
        category: params.get("category") ?? "",
        filterKey: params.get("f") ?? "",
        exact: params.get("exact") === "1",
      },
      sid: Number.isInteger(sid) && sid > 0 ? sid : null,
    };
  } catch {
    return { query: { ...EMPTY_QUERY }, sid: null };
  }
}

const isReady = (query) => Boolean(query.keyword || query.category);
const categoryText = (category) => (category.startsWith("group:") ? `${category.slice(6)} 전체` : category);

// ---------- 결과 카드 ----------
function conditionLines(query, conditions) {
  const lines = [];
  if (query.keyword) lines.push(`검색어 **${query.keyword}**${query.exact ? " (정확히 일치)" : ""}`);
  if (query.category) lines.push(`분류 **${categoryText(query.category)}**`);
  if (conditions.length > 0) lines.push("상세 조건", ...conditions.map((each) => `• ${each}`));
  return lines;
}

function resultLines(result) {
  if (!result.ready) return ["검색어나 분류를 정하면 결과가 나옵니다."];
  if (result.total === 0) return ["조건에 맞는 매물이 없습니다."];
  return result.items.flatMap((item, index) => {
    const count = item.count > 1 ? ` ×${won(item.count)}` : "";
    const head = `**${index + 1}.** ${won(item.price)} ${item.name}${count}`;
    return item.notes.length > 0 ? [head, `　${item.notes.join(" / ")}`] : [head];
  });
}

/** 결과 카드. 제목 링크가 상태이자 사이트로 가는 길이다. 시각은 데이터를 읽은 때다. */
export function searchCard(result, { sid = null, title = "경매장 검색", stats = null } = {}) {
  const lines = [...conditionLines(result.query, result.conditions ?? [])];
  if (stats) lines.push(stats);
  if (lines.length > 0) lines.push("");
  lines.push(...resultLines(result));
  const footer = result.ready
    ? `조건에 맞는 매물 ${won(result.total)}개${result.truncated ? " (앞쪽 일부만 읽음)" : ""}`
    : "넥슨 경매장 검색";
  return {
    title: title.slice(0, 256),
    url: stateUrl(result.query, sid),
    color: ACCENT,
    description: lines.join("\n").slice(0, 4000),
    footer: { text: footer },
    ...(result.checkedAt ? { timestamp: new Date(result.checkedAt).toISOString() } : {}),
  };
}

export function searchButtons(query, { sid = null, ready = isReady(query), conditionCount = 0 } = {}) {
  return [
    row(
      button("q:kw", "검색어", PRIMARY),
      button("q:cat", "분류"),
      button("q:cond", conditionCount > 0 ? `상세 조건 ${conditionCount}` : "상세 조건", undefined, { disabled: !ready }),
      button("q:exact", query.exact ? "정확히 일치: 켜짐" : "정확히 일치: 꺼짐", query.exact ? SUCCESS : undefined, {
        disabled: !query.keyword,
      }),
      button("q:reset", "초기화"),
    ),
    row(
      button("q:save", sid ? "저장 검색 고치기" : "즐겨찾기에 저장", SUCCESS, { disabled: !ready }),
      button("q:share", "채널에 공유", undefined, { disabled: !ready }),
      button("q:refresh", "새로고침", undefined, { disabled: !ready }),
      sid ? button(`f:show:${sid}`, "← 저장 검색") : null,
      menuButton(),
    ),
    row(linkButton("사이트에서 보기", stateUrl(query))),
  ];
}

/** 검색 화면 하나. 결과 카드와 조작 단추. */
export function searchView(result, { sid = null, title, stats } = {}) {
  return view("", searchButtons(result.query, { sid, ready: result.ready, conditionCount: (result.conditions ?? []).length }), [
    searchCard(result, { sid, title, stats }),
  ]);
}

/** 정확히 일치하는 아이템 검색이면 거래 기록 요약을 한 줄 붙인다. */
async function statsLine(env, query) {
  if (!query.exact || !query.keyword || query.category) return null;
  const summary = await env.SITE.marketSummary(query.keyword).catch(() => null);
  if (!summary?.day) return null;
  return `최근 24시간 거래 ${won(summary.day.n)}건, 중위가 **${won(summary.day.mid)}**`;
}

/** 조건으로 검색해 화면을 만든다. 저장 검색을 고치는 중이면 sid 와 이름을 이어 간다. */
export async function renderSearch(env, query, { sid = null, title } = {}) {
  const [result, stats] = await Promise.all([
    env.SITE.searchAuction(query, { limit: RESULT_LIMIT }),
    statsLine(env, query),
  ]);
  return searchView(result, { sid, title, stats });
}

/** 검색을 공유용으로 만든다. 개인 단추 없이 카드와 사이트 링크만 둔다. */
async function renderShare(env, query) {
  const result = await env.SITE.searchAuction(query, { limit: RESULT_LIMIT });
  return view("", [row(linkButton("사이트에서 보기", stateUrl(result.query)))], [searchCard(result)]);
}

// ---------- 분류 ----------
let treeCache = null;
async function categoryTree(env) {
  treeCache ??= await env.SITE.categoryTree();
  return treeCache;
}
export const resetCategoryTreeForTest = () => {
  treeCache = null;
};

function categoryPanel(tree, query, groupIndex) {
  const current = query.category;
  const chosen = groupIndex ?? tree.findIndex((group) => group.key === current || group.categories.includes(current));
  const rows = [
    row(
      select(
        "q:grp",
        "분류 묶음",
        tree.map((group, index) => ({ label: group.name, value: String(index), default: index === chosen })),
      ),
    ),
  ];
  if (chosen >= 0) {
    const group = tree[chosen];
    rows.push(
      row(
        select("q:catpick", "분류", [
          { label: `${group.name} 전체`, value: group.key, default: current === group.key },
          ...group.categories.map((category) => ({ label: category, value: category, default: current === category })),
        ]),
      ),
    );
  }
  rows.push(row(current ? button("q:catclear", "분류 지우기") : null, button("q:back", "← 결과로")));
  return rows;
}

const keepCard = (interaction, components, content = "") =>
  view(content, components, interaction?.message?.embeds ?? []);

// ---------- 상세 조건 ----------
function conditionPanel(catalog, query) {
  const conditions = catalog.conditions ?? [];
  const rows = [];
  if (conditions.length > 0) {
    rows.push(
      row(
        select(
          "k:rm",
          "조건 빼기",
          conditions.map((label, index) => ({ label, value: String(index) })),
        ),
      ),
    );
  }
  const entries = catalog.entries.filter((entry) => fitsId(`k:v:${entry.kind}${SEP}${entry.optionType}`));
  if (entries.length > 0) {
    rows.push(
      row(
        select(
          "k:add",
          "조건 더하기",
          entries.map((entry) => ({
            label: entry.label,
            value: `${entry.kind}${SEP}${entry.optionType}`,
            description: entry.kind === "color" ? "사이트에서 정합니다" : `매물 ${won(entry.count)}개에 있음`,
          })),
        ),
      ),
    );
  }
  rows.push(row(linkButton("사이트에서 고치기", stateUrl(query)), button("q:back", "← 결과로")));
  const content = entries.length === 0 ? "고를 수 있는 옵션이 없습니다. 검색어나 분류를 먼저 정해 보세요." : "";
  return { rows, content };
}

/** 고르는 값의 목록. 종류마다 이름, 접두·접미, 등급, 정보 칸 가운데 무엇을 고르는지가 다르다. */
function choicesOf(entry) {
  const counted = (list) => list.map(({ value, count }) => ({ label: value, value, description: `${won(count)}개` }));
  switch (entry.kind) {
    case "reforge":
      return [{ label: "아무 세공", value: ANY }, ...counted(entry.values)];
    case "relic":
      return [{ label: "아무 옵션", value: ANY }, ...counted(entry.values)];
    case "named":
    case "text":
      return counted(entry.values);
    case "enchant":
      return Object.entries(entry.valuesBySub ?? {}).flatMap(([slot, list]) =>
        list.map(({ value, count }) => ({ label: `${slot} ${value}`, value: `${slot}${PAIR}${value}`, description: `${won(count)}개` })),
      );
    case "special":
    case "erg":
      return [{ label: "상관없음", value: ANY }, ...(entry.subTypes ?? []).map((sub) => ({ label: sub, value: sub }))];
    case "pet":
    case "sub":
      return (entry.subTypes ?? []).map((sub) => ({ label: sub, value: sub }));
    default:
      return [];
  }
}

/** 문턱값 목록의 열쇠. 이름별로 따로 세는 종류와 칸 하나로 세는 종류가 있다. */
function thresholdKey(kind, choice) {
  if (["reforge", "relic", "named"].includes(kind)) return choice === ANY ? "" : choice;
  if (kind === "pet" || kind === "sub") return choice;
  return "";
}

const UNIT = { reforge: "레벨", relic: "레벨", named: "레벨", special: "단계", erg: "레벨" };

/** 봇이 고른 값으로 사이트에 보낼 조건. 값의 검증은 사이트가 한다. */
export function specOf(kind, optionType, choice, min) {
  const any = choice === ANY;
  switch (kind) {
    case "reforge":
    case "relic":
      return { kind, optionType, name: any ? "" : choice, minLevel: min };
    case "named":
      return { kind, optionType, name: choice, minLevel: min };
    case "enchant": {
      const [slot, name] = choice.split(PAIR);
      return slot === "접미" ? { kind, optionType, suffix: name } : { kind, optionType, prefix: name };
    }
    case "special":
      return { kind, optionType, type: any ? "" : choice, minStep: min };
    case "erg":
      return { kind, optionType, grade: any ? "" : choice, minLevel: min };
    case "pet":
      return choice.startsWith(`종족명${PAIR}`)
        ? { kind, optionType, field: "종족명", text: choice.slice(4) }
        : { kind, optionType, field: choice, min };
    case "sub":
      return { kind, optionType, sub: choice, min };
    case "number":
      return { kind, optionType, min };
    case "text":
      return { kind, optionType, text: choice };
    default:
      return { kind, optionType };
  }
}

/** 값을 고르면 바로 끝나는 종류. 나머지는 문턱값(이상)을 한 번 더 고른다. */
const finishesAtChoice = (kind, choice) =>
  kind === "enchant" || kind === "text" || (kind === "pet" && choice.startsWith(`종족명${PAIR}`));

function choiceStep(entry) {
  const ref = `${entry.kind}${SEP}${entry.optionType}`;
  if (entry.kind === "color") {
    return { content: "색상 조건은 사이트에서 정해 주세요.", rows: [] };
  }
  if (entry.kind === "number") return thresholdStep(entry, "");
  const choices = choicesOf(entry).filter((choice) => fitsId(`k:t:${ref}${SEP}${choice.value}`));
  return {
    content: `**${entry.label}** 무엇을 고를까요?`,
    rows: [row(select(`k:v:${ref}`, entry.label, choices)), row(button("q:cond", "← 조건으로"), button("q:back", "← 결과로"))],
  };
}

function thresholdStep(entry, choice) {
  const ref = `${entry.kind}${SEP}${entry.optionType}${SEP}${choice}`;
  const suggestions = entry.thresholds?.[thresholdKey(entry.kind, choice)] ?? [];
  const unit = UNIT[entry.kind] ?? "";
  const options = suggestions.map(({ value, count }) => ({
    label: `${won(value)}${unit} 이상`,
    value: String(value),
    description: `${won(count)}개`,
  }));
  const optional = !["number", "sub"].includes(entry.kind) && !(entry.kind === "pet");
  if (optional && choice !== ANY) options.unshift({ label: `${unit || "값"} 상관없음`, value: ANY });
  return {
    content: `**${entry.label}${choice && choice !== ANY ? ` ${choice}` : ""}** 얼마 이상을 찾을까요?`,
    rows: [
      options.length > 0 && fitsId(`k:t:${ref}`) ? row(select(`k:t:${ref}`, "이상", options)) : null,
      row(
        fitsId(`k:man:${ref}`) ? button(`k:man:${ref}`, "직접 입력", PRIMARY) : null,
        button("q:cond", "← 조건으로"),
        button("q:back", "← 결과로"),
      ),
    ].filter(Boolean),
  };
}

async function findEntry(env, query, kind, optionType) {
  const catalog = await env.SITE.searchCatalog(query);
  return catalog.entries.find((entry) => entry.kind === kind && entry.optionType === optionType) ?? null;
}

/** 조건을 더하고 다시 검색한 화면. */
async function addAndSearch(env, state, spec) {
  const query = await env.SITE.addSearchCondition(state.query, spec);
  return renderSearch(env, query, { sid: state.sid });
}

// ---------- 상호작용 ----------
/** 검색 화면의 단추와 선택 메뉴(q:). */
export async function searchComponent(env, interaction, act, values) {
  const state = stateOf(interaction);
  const research = (query) => deferred("update", () => renderSearch(env, query, { sid: state.sid }));
  switch (act) {
    case "kw":
      return modal("q:kwm", "검색어", [
        { id: "keyword", label: "검색어 (비우면 분류로만 찾음)", required: false, max: 100, value: state.query.keyword, placeholder: "예: 낙지" },
      ]);
    case "cat":
      return update(keepCard(interaction, categoryPanel(await categoryTree(env), state.query)));
    case "grp":
      return update(keepCard(interaction, categoryPanel(await categoryTree(env), state.query, Number(values[0]))));
    case "catpick":
      return research({ ...state.query, category: values[0] ?? "" });
    case "catclear":
      return research({ ...state.query, category: "" });
    case "exact":
      return research({ ...state.query, exact: !state.query.exact });
    case "reset":
      return research({ ...EMPTY_QUERY });
    case "refresh":
    case "back":
      return research(state.query);
    case "share":
      return deferred("public", () => renderShare(env, state.query));
    case "cond":
      return deferred("update", async () => {
        const catalog = await env.SITE.searchCatalog(state.query);
        const panel = conditionPanel(catalog, state.query);
        return keepCard(interaction, panel.rows, panel.content);
      });
    default:
      return null;
  }
}

/** 상세 조건 편집(k:). 값 이름에 | 가 들어갈 수 있으므로 앞의 두 칸만 나누고 나머지는 고른 값으로 본다. */
export async function conditionComponent(env, interaction, act, rest, values) {
  const state = stateOf(interaction);
  const [kind, optionType, ...more] = rest.split(SEP);
  const choice = more.join(SEP);
  const back = (step) => keepCard(interaction, step.rows, step.content);
  switch (act) {
    case "rm":
      return deferred("update", async () => {
        const query = await env.SITE.removeSearchCondition(state.query, Number(values[0]));
        return renderSearch(env, query, { sid: state.sid });
      });
    case "add": {
      const [pickedKind, ...type] = String(values[0] ?? "").split(SEP);
      return deferred("update", async () => {
        const entry = await findEntry(env, state.query, pickedKind, type.join(SEP));
        if (!entry) return noticeView("그 옵션이 지금 결과에 없습니다. 다시 골라 주세요.", button("q:cond", "← 조건으로"));
        return back(choiceStep(entry));
      });
    }
    case "v": {
      const picked = values[0] ?? "";
      if (finishesAtChoice(kind, picked)) return deferred("update", () => addAndSearch(env, state, specOf(kind, optionType, picked, null)));
      if (kind === "pet" && picked === "종족명") {
        return deferred("update", async () => {
          const entry = await findEntry(env, state.query, kind, optionType);
          const species = (entry?.values ?? []).map(({ value, count }) => ({ label: value, value: `종족명${PAIR}${value}`, description: `${won(count)}개` }));
          return back({
            content: "**펫 종족** 무엇을 고를까요?",
            rows: [row(select(`k:v:${kind}${SEP}${optionType}`, "종족", species)), row(button("q:cond", "← 조건으로"))],
          });
        });
      }
      return deferred("update", async () => {
        const entry = await findEntry(env, state.query, kind, optionType);
        if (!entry) return noticeView("그 옵션이 지금 결과에 없습니다. 다시 골라 주세요.", button("q:cond", "← 조건으로"));
        return back(thresholdStep(entry, picked));
      });
    }
    case "t": {
      const picked = values[0] ?? ANY;
      const min = picked === ANY ? null : Number(picked);
      return deferred("update", () => addAndSearch(env, state, specOf(kind, optionType, choice, min)));
    }
    case "man":
      return modal(`k:mm:${rest}`, "직접 입력", [{ id: "min", label: "최소 값 (이상)", max: 12, placeholder: "예: 15" }]);
    default:
      return null;
  }
}

/** 검색 화면의 입력창 제출(q:kwm, k:mm). */
export async function searchModal(env, interaction, namespace, act, rest, fields) {
  const state = stateOf(interaction);
  if (namespace === "q" && act === "kwm") {
    const query = { ...state.query, keyword: String(fields.keyword ?? "").trim() };
    if (!query.keyword) query.exact = false;
    return deferred("update", () => renderSearch(env, query, { sid: state.sid }));
  }
  if (namespace === "k" && act === "mm") {
    const [kind, optionType, ...more] = rest.split(SEP);
    const min = Number(String(fields.min ?? "").replace(/[,\s]/g, ""));
    if (!Number.isFinite(min)) return update(noticeView("숫자로 입력해 주세요.", button("q:cond", "← 조건으로")));
    return deferred("update", () => addAndSearch(env, state, specOf(kind, optionType, more.join(SEP), min)));
  }
  return null;
}

/** 새 검색 화면. 메뉴와 /마비쿠마 아이템:… 이 연다. */
export const openSearch = (env, query = EMPTY_QUERY, options = {}) => renderSearch(env, query, options);
