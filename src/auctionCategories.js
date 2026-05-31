function compactCategoryText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s"'`.,/\\|()[\]{}<>:;!?~_\-+*=]+/g, "");
}

export const AUCTION_ITEM_CATEGORIES = [
  "개조석",
  "검",
  "경갑옷",
  "기타",
  "기타 소모품",
  "기타 스크롤",
  "기타 장비",
  "기타 재료",
  "꼬리",
  "날개",
  "낭만농장/달빛섬",
  "너클",
  "던전 통행증",
  "도끼",
  "도면",
  "둔기",
  "듀얼건",
  "랜스",
  "로브",
  "마기그래프",
  "마기그래프 도안",
  "마도서",
  "마리오네트",
  "마법가루",
  "마비노벨",
  "마족 스크롤",
  "말풍선 스티커",
  "매직 크래프트",
  "모자/가발",
  "방패",
  "변신 메달",
  "보석",
  "분양 메달",
  "불타래",
  "뷰티 쿠폰",
  "생활 도구",
  "석궁",
  "수리검",
  "스케치",
  "스태프",
  "신발",
  "실린더",
  "아틀라틀",
  "악기",
  "알반 훈련석",
  "액세서리",
  "양손 장비",
  "얼굴 장식",
  "에이도스",
  "에코스톤",
  "염색 앰플",
  "오브",
  "옷본",
  "원거리 소모품",
  "원드",
  "음식",
  "의자/사물",
  "인챈트 스크롤",
  "장갑",
  "제련/블랙스미스",
  "제스처",
  "주머니",
  "중갑옷",
  "책",
  "천옷",
  "천옷/방직",
  "체인 블레이드",
  "토템",
  "팔리아스 유물",
  "퍼퓸",
  "페이지",
  "포션",
  "피니 펫",
  "핀즈비즈",
  "한손 장비",
  "핸들",
  "허브",
  "활",
  "힐웬 공학",
];

export const AUCTION_CATEGORY_GROUPS = [
  {
    name: "근거리 장비",
    categories: ["한손 장비", "양손 장비", "검", "도끼", "둔기", "랜스", "핸들", "너클", "체인 블레이드"],
  },
  {
    name: "원거리 장비",
    categories: ["활", "석궁", "듀얼건", "수리검", "아틀라틀", "원거리 소모품"],
  },
  {
    name: "마법 장비",
    categories: ["실린더", "스태프", "원드", "마도서", "오브"],
  },
  {
    name: "갑옷 장비",
    categories: ["중갑옷", "경갑옷", "천옷"],
  },
  {
    name: "방어 장비",
    categories: ["장갑", "신발", "모자/가발", "방패", "로브"],
  },
  {
    name: "액세서리 전체",
    categories: ["얼굴 장식", "액세서리", "날개", "꼬리"],
  },
  {
    name: "특수 장비",
    categories: ["악기", "생활 도구", "마리오네트", "에코스톤", "에이도스", "팔리아스 유물", "기타 장비"],
  },
  {
    name: "설치물",
    categories: ["의자/사물", "낭만농장/달빛섬"],
  },
  {
    name: "인챈트 용품",
    categories: ["인챈트 스크롤", "마법가루"],
  },
  {
    name: "스크롤",
    categories: ["도면", "옷본", "마족 스크롤", "기타 스크롤"],
  },
  {
    name: "마기그래프 용품",
    categories: ["마기그래프", "마기그래프 도안", "기타 재료"],
  },
  {
    name: "서적",
    categories: ["책", "마비노벨", "페이지"],
  },
  {
    name: "소모품",
    categories: ["포션", "음식", "허브", "던전 통행증", "알반 훈련석", "개조석", "보석", "변신 메달", "염색 앰플", "스케치", "핀즈비즈", "기타 소모품"],
  },
  {
    name: "토템 전체",
    categories: ["토템"],
  },
  {
    name: "생활 재료",
    categories: ["주머니", "천옷/방직", "제련/블랙스미스", "힐웬 공학", "매직 크래프트"],
  },
  {
    name: "기타 전체",
    categories: ["제스처", "말풍선 스티커", "피니 펫", "불타래", "퍼퓸", "분양 메달", "뷰티 쿠폰", "기타"],
  },
];

const CATEGORY_ALIASES = new Map([
  ["악세서리", "액세서리"],
  ["악세서리 전체", "액세서리 전체"],
  ["액세서리 그룹", "액세서리 전체"],
  ["기타 그룹", "기타 전체"],
  ["전체 기타", "기타 전체"],
  ["유물", "팔리아스 유물"],
  ["팔리아스유물", "팔리아스 유물"],
  ["애뮬릿", "토템"],
]);

const exactCategoryLookup = new Map();
const groupCategoryLookup = new Map();
const categorySearchLabels = [];

for (const category of AUCTION_ITEM_CATEGORIES) {
  exactCategoryLookup.set(compactCategoryText(category), {
    input: category,
    label: category,
    categories: [category],
    isGroup: false,
  });
  categorySearchLabels.push(category);
}

for (const group of AUCTION_CATEGORY_GROUPS) {
  groupCategoryLookup.set(compactCategoryText(group.name), {
    input: group.name,
    label: group.name,
    categories: group.categories,
    isGroup: true,
  });
  categorySearchLabels.push(group.name);
}

for (const [alias, target] of CATEGORY_ALIASES) {
  const resolved = exactCategoryLookup.get(compactCategoryText(target)) ?? groupCategoryLookup.get(compactCategoryText(target));
  if (resolved) {
    exactCategoryLookup.set(compactCategoryText(alias), {
      ...resolved,
      input: alias,
      aliasFor: resolved.label,
    });
    categorySearchLabels.push(alias);
  }
}

export function resolveAuctionCategory(input) {
  const compactInput = compactCategoryText(input);
  if (!compactInput) {
    return null;
  }

  if (compactInput === compactCategoryText("전체")) {
    return {
      input,
      label: "전체",
      categories: [],
      isGroup: false,
    };
  }

  return exactCategoryLookup.get(compactInput) ?? groupCategoryLookup.get(compactInput) ?? null;
}

export function suggestAuctionCategories(input, limit = 8) {
  const compactInput = compactCategoryText(input);
  if (!compactInput) {
    return categorySearchLabels.slice(0, limit);
  }

  const matches = categorySearchLabels.filter((label) => compactCategoryText(label).includes(compactInput));
  return [...new Set(matches)].slice(0, limit);
}

export function getAuctionCategoryGroup(groupName) {
  return AUCTION_CATEGORY_GROUPS.find((group) => group.name === groupName) ?? null;
}

export function formatAuctionCategoryHelp() {
  return AUCTION_CATEGORY_GROUPS.map((group) => `${group.name}: ${group.categories.join(", ")}`).join("\n");
}
