import { hourLabel } from "./daily.js";
import { erinClock, formatErinClock, formatShopReset, msUntilShopReset } from "./erin.js";
import { relativeTime } from "./format.js";
import {
  DANGER,
  PRIMARY,
  SECONDARY,
  SUCCESS,
  button,
  linkButton,
  menuButton,
  noticeView,
  row,
  select,
  v2View,
  view,
} from "./ui.js";

export { button, linkButton, noticeView, row, select };

/** 동의 문구가 바뀌면 이 값과 사이트의 개인정보처리방침을 함께 고친다. */
export const CONSENT_VERSION = "2026-10-19";

const PRIVACY_URL = "https://mabi.spkuma.com/privacy";
const SITE_URL = "https://mabi.spkuma.com/?ref=bot";



/** 메뉴. 동의한 사용자에게는 지금 상태를 한 줄로 보여 준다. */
/** 메뉴. 서버 관리자가 서버에 설치된 봇을 열면 서버 설정 단추가 더해진다. */
export function menuView(overview, { guildAdmin = false } = {}) {
  const lines = ["**마비쿠마**", "원하는 기능을 눌러 주세요."];
  if (overview) {
    const state = overview.paused ? "알림 일시정지" : "알림 켜짐";
    lines.push(`-# 즐겨찾기 ${overview.favorites}개 · 아르바이트 ${overview.arbeit}개 · ${state}`);
  }
  return view(lines.join("\n"), [
    row(
      button("m:price", "시세 보기", PRIMARY),
      button("m:fav", "즐겨찾기 알림"),
      button("m:ab", "아르바이트 알림"),
      button("m:erin", "에린 시계"),
    ),
    row(
      button("m:set", "알림 설정"),
      button("m:me", "내 정보"),
      guildAdmin ? button("g:open", "서버 설정") : null,
      linkButton("사이트 열기", SITE_URL),
    ),
  ]);
}

/** 개인 기능을 처음 쓸 때의 동의 화면. 동의하면 가려던 화면으로 이어 간다. */
export function consentView(target) {
  return view(
    [
      "**개인 기능을 켜려면 동의가 필요합니다.**",
      "저장하는 정보: 디스코드 사용자 번호, 동의 시점, 알림 설정, 구독한 아르바이트 항목, 즐겨찾기 알림에 등록한 검색과 이미 알린 매물",
      "쓰는 곳: 알림을 DM으로 보내는 데에만 씁니다.",
      "지우는 방법: 메뉴의 내 정보에서 삭제",
      `자세한 내용: ${PRIVACY_URL}`,
    ].join("\n"),
    [row(button(`c:ok:${target}`, "동의하고 시작", SUCCESS), menuButton())],
  );
}

export function erinText(now) {
  const clock = erinClock(now);
  const phase = clock.day ? "낮" : "밤";
  return `에린 시각 **${formatErinClock(clock)}** (${phase})\n다음 상점 교체까지 **${formatShopReset(msUntilShopReset(now))}**`;
}

export function erinView(now) {
  return view(erinText(now), [
    row(button("e:r", "새로고침"), button("e:share", "채널에 공유"), menuButton()),
  ]);
}

/** 한 쪽에 두는 묶음 수. 묶음마다 행과 메뉴로 2개씩이라 글 1개, 단추 행 6개를 더해도 40개 안에 든다. */
export const ARBEIT_PAGE_SIZE = 12;
export const ARBEIT_OFF = "off";

/** 시간표를 묶음(식료품점, 대장간…)으로 모은다. 순서는 시간표 순서다. */
export function arbeitGroups(entries) {
  const groups = [];
  for (const entry of entries) {
    let group = groups.find((each) => each.name === entry.group);
    if (!group) groups.push((group = { name: entry.group, entries: [] }));
    group.entries.push(entry);
  }
  return groups;
}

const arbeitHours = (entry) =>
  entry.recruit
    ? `모집 ${entry.recruit[0]}~${entry.recruit[1]}시, 보고 ${entry.report}시부터`
    : `보고 ${entry.report}시부터`;

/**
 * 아르바이트 알림. 게임에서 한 묶음은 에린 하루에 한 번만 할 수 있어 묶음마다 하나만 고른다.
 * 묶음이 많아 새 형식 메시지로 두 쪽에 나눈다.
 */
export function arbeitView(entries, subscribed, page = 0) {
  const on = new Set(subscribed);
  const groups = arbeitGroups(entries);
  const pages = Math.max(1, Math.ceil(groups.length / ARBEIT_PAGE_SIZE));
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const active = groups.filter((group) => group.entries.some((entry) => on.has(entry.id))).length;

  const menus = groups.slice(current * ARBEIT_PAGE_SIZE, (current + 1) * ARBEIT_PAGE_SIZE).map((group, offset) => {
    const chosen = group.entries.find((entry) => on.has(entry.id));
    return row(
      select(`a:g:${current * ARBEIT_PAGE_SIZE + offset}`, `${group.name}: 알림 끔`, [
        ...group.entries.map((entry) => ({
          label: entry.label,
          value: entry.id,
          description: arbeitHours(entry),
          default: entry === chosen,
        })),
        { label: "알림 끄기", value: ARBEIT_OFF },
      ]),
    );
  });
  const paging =
    pages > 1
      ? [
          button(`a:p:${current - 1}`, "← 이전", SECONDARY, { disabled: current === 0 }),
          button("a:pg", `${current + 1}/${pages}`, SECONDARY, { disabled: true }),
          button(`a:p:${current + 1}`, "다음 →", SECONDARY, { disabled: current === pages - 1 }),
        ]
      : [];
  return v2View(
    [`**아르바이트 알림** ${active}개 묶음 켜짐`],
    [...menus, row(...paging, button(`a:none:${current}`, "전체 끄기"), menuButton())],
  );
}

export const QUIET_PRESETS = [
  ["off", "조용한 시간 없음", null],
  ["22-7", "22시~7시", { start: 22, end: 7 }],
  ["23-7", "23시~7시", { start: 23, end: 7 }],
  ["0-8", "0시~8시", { start: 0, end: 8 }],
  ["1-9", "1시~9시", { start: 1, end: 9 }],
];

export function describeSettings(settings) {
  const parts = [settings.digest ? "한 메시지로 묶어 받기" : "항목마다 따로 받기"];
  parts.push(
    settings.quiet ? `조용한 시간 ${settings.quiet.start}시~${settings.quiet.end}시` : "조용한 시간 없음",
  );
  parts.push(Number.isInteger(settings.daily) ? `매일 알림 ${hourLabel(settings.daily)}` : "매일 알림 꺼짐");
  if (settings.disabledReason === "dm-failed") {
    parts.push("DM을 보낼 수 없어 멈춤 (DM을 허용한 뒤 일시정지를 끄세요)");
  } else if (settings.paused) {
    parts.push("일시정지");
  }
  return parts.join(" · ");
}

/** 알림 설정. 아르바이트와 즐겨찾기 알림이 함께 따른다. */
export function settingsView(settings) {
  const current = settings.quiet
    ? QUIET_PRESETS.find(([, , quiet]) => quiet && quiet.start === settings.quiet.start && quiet.end === settings.quiet.end)
    : QUIET_PRESETS[0];
  const options = QUIET_PRESETS.map(([value, label]) => ({
    label,
    value,
    default: current ? current[0] === value : false,
  }));
  if (!current) {
    options.unshift({
      label: `직접 설정 ${settings.quiet.start}시~${settings.quiet.end}시`,
      value: "keep",
      default: true,
    });
  }
  return view(
    [
      "**알림 설정**",
      describeSettings(settings),
      "-# 시간은 한국 시각 기준이며 아르바이트, 새 매물, 자정 전 알림에 적용됩니다.",
    ].join("\n"),
    [
      row(
        button("s:digest", settings.digest ? "묶어서 받기: 켜짐" : "묶어서 받기: 꺼짐", settings.digest ? SUCCESS : SECONDARY),
        button("s:pause", settings.paused ? "일시정지: 켜짐" : "일시정지: 꺼짐", settings.paused ? DANGER : SECONDARY),
      ),
      row(select("s:quiet", "조용한 시간", options)),
      row(button("s:custom", "조용한 시간 직접 입력"), button("s:daily", "매일 알림"), menuButton()),
    ],
  );
}

export function meView(user, favoriteCount, linked) {
  return view(
    [
      "**내 정보**",
      `즐겨찾기 ${favoriteCount}개 · 아르바이트 ${user.arbeit.length}개 · 동의 ${relativeTime(user.consentedAt)}`,
      `사이트 계정 ${linked ? "연결됨" : "연결 안 됨"}`,
      "-# 삭제하면 설정, 구독, 저장한 검색이 모두 지워지며 되돌릴 수 없습니다.",
    ].join("\n"),
    [
      row(
        linked ? button("me:unlink", "사이트 연결 해제") : button("me:link", "사이트 계정 연결", PRIMARY),
        button("me:ask", "모든 정보 삭제", DANGER),
        menuButton(),
      ),
    ],
  );
}

/** 사이트 프로필에 입력할 일회용 코드. 코드 칸은 길게 눌러 복사하기 쉽게 코드 서식으로 둔다. */
export function linkCodeView(code) {
  return view(
    [
      "**사이트 계정 연결 코드**",
      `\`${code}\``,
      "사이트에 로그인한 뒤 프로필의 디스코드 연결에 입력하세요. 10분 안에 한 번만 쓸 수 있습니다.",
    ].join("\n"),
    [row(linkButton("사이트 열기", SITE_URL), menuButton())],
  );
}

export function confirmDeleteView() {
  return view("설정, 구독, 저장한 검색을 모두 삭제합니다. 정말 삭제할까요?", [
    row(button("me:del", "삭제", DANGER), button("me:cancel", "취소")),
  ]);
}

export function deletedView() {
  return view("저장된 정보를 모두 삭제했습니다.", [row(button("m:menu", "메뉴로", PRIMARY))]);
}

