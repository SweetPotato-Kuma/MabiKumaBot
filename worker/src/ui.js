// 디스코드 메시지 조각과 상호작용 응답을 만드는 작은 함수들. 화면 파일들이 같이 쓴다.

export const PRIMARY = 1;
export const SECONDARY = 2;
export const SUCCESS = 3;
export const DANGER = 4;
const LINK = 5;

const CHANNEL_MESSAGE = 4;
const UPDATE_MESSAGE = 7;
const MODAL = 9;
export const EPHEMERAL = 64;
/** 새 형식(Components V2) 메시지. 이미 보낸 메시지에 붙이거나 뗄 수 없다. */
export const COMPONENTS_V2 = 1 << 15;

/** 사이트 로고의 보라. 검색 결과 카드의 띠 색이다. */
export const ACCENT = 0x9e3563;

/** custom_id 는 100자까지다. 넘으면 그 단추나 메뉴를 만들지 않는다. */
export const fitsId = (customId) => customId.length <= 100;

export const button = (customId, label, style = SECONDARY, extra = {}) => ({
  type: 2,
  custom_id: customId,
  label,
  style,
  ...extra,
});
export const linkButton = (label, url) => ({ type: 2, style: LINK, label, url });
export const row = (...components) => ({ type: 1, components: components.filter(Boolean) });
/**
 * 선택 메뉴. 디스코드는 항목이 없거나 이름이나 값이 빈 항목이 있으면 메시지 전체를 거절하므로,
 * 빈 항목은 빼고 남는 것이 없으면 메뉴를 만들지 않는다(null, row 가 걸러 낸다).
 */
export function select(customId, placeholder, options, { min = 1, max = 1 } = {}) {
  const kept = options
    .filter((option) => String(option.label ?? "").trim() !== "" && String(option.value ?? "") !== "")
    .slice(0, 25)
    .map((option) => ({
      ...option,
      label: String(option.label).slice(0, 100),
      value: String(option.value).slice(0, 100),
      ...(option.description ? { description: String(option.description).slice(0, 100) } : {}),
    }));
  if (kept.length === 0) return null;
  return {
    type: 3,
    custom_id: customId,
    placeholder: String(placeholder).slice(0, 150),
    min_values: Math.min(min, kept.length),
    max_values: Math.max(1, Math.min(max, kept.length)),
    options: kept,
  };
}

/** 화면 하나. 글만 쓰는 화면과 카드(embed)를 쓰는 화면이 서로 바뀌어도 앞 화면의 것이 남지 않게 둘 다 적는다. */
export const view = (content, components = [], embeds = []) => ({
  content,
  embeds,
  components: components.filter((each) => each.components?.length > 0),
});

/**
 * 새 형식 화면. 행(action row)을 다섯 개보다 많이 둘 수 있는 대신 content 와 embeds 를 쓰지 못해 글은 글 칸(10)에 넣는다.
 * 한 메시지에 구성요소가 모두 40개까지다(행과 그 안의 단추·메뉴를 따로 센다).
 */
export const v2View = (texts, components = []) => ({
  flags: COMPONENTS_V2,
  components: [
    ...texts.map((content) => ({ type: 10, content })),
    ...components.filter((each) => each.components?.length > 0),
  ],
});
export const isV2 = (interaction) => ((interaction?.message?.flags ?? 0) & COMPONENTS_V2) !== 0;

export const menuButton = () => button("m:menu", "← 메뉴");

export const noticeView = (text, ...buttons) => view(text, [row(...buttons, menuButton())]);

// ---------- 상호작용 응답 ----------
export function newMessage(body, { ephemeral = true } = {}) {
  const flags = (body.flags ?? 0) | (ephemeral ? EPHEMERAL : 0);
  return { body: { type: CHANNEL_MESSAGE, data: { ...body, ...(flags ? { flags } : {}) } } };
}
export const update = (body) => ({ body: { type: UPDATE_MESSAGE, data: body } });
/** 넥슨을 읽는 화면은 3초 안에 끝나지 않을 수 있어 먼저 "처리 중"으로 답하고 나중에 내용을 채운다. */
export const deferred = (kind, run) => ({ defer: kind, run });
export const message = (text) => newMessage(noticeView(text));

/** 새 형식 메시지는 일반 화면으로 고칠 수 없다. 거기서 여는 일반 화면은 새 메시지로 띄운다. */
export function keepFormat(interaction, response) {
  if (!isV2(interaction) || !response) return response;
  if (response.defer === "update") return { ...response, defer: "new" };
  const data = response.body?.data;
  if (response.body?.type === UPDATE_MESSAGE && !((data?.flags ?? 0) & COMPONENTS_V2)) return newMessage(data);
  return response;
}

/** 입력창. 칸마다 이름, 길이, 미리 채울 값, 예시를 받는다. */
export const modal = (customId, title, inputs) => ({
  body: {
    type: MODAL,
    data: {
      custom_id: customId,
      title: title.slice(0, 45),
      components: inputs.map((input) => ({
        type: 1,
        components: [
          {
            type: 4,
            custom_id: input.id,
            label: input.label.slice(0, 45),
            style: 1,
            required: input.required ?? true,
            max_length: input.max ?? 100,
            ...(input.value ? { value: String(input.value).slice(0, input.max ?? 100) } : {}),
            ...(input.placeholder ? { placeholder: input.placeholder } : {}),
          },
        ],
      })),
    },
  },
});

// ---------- 입력 읽기 ----------
export const userIdOf = (interaction) => interaction?.member?.user?.id ?? interaction?.user?.id ?? null;

export function fieldsOf(interaction) {
  const fields = {};
  for (const line of interaction?.data?.components ?? []) {
    for (const component of line.components ?? []) fields[component.custom_id] = component.value ?? "";
  }
  return fields;
}

const MAX_PRICE = 10_000_000_000;

/** 가격 입력. 비우면 undefined, 숫자가 아니면 null. 쉼표와 띄어쓰기는 무시한다. */
export function parsePrice(text) {
  const clean = String(text ?? "").replace(/[,\s]/g, "");
  if (clean === "") return undefined;
  if (!/^\d+$/.test(clean)) return null;
  const value = Number(clean);
  return value <= MAX_PRICE ? value : null;
}

export const won = (value) => Number(value).toLocaleString("ko-KR");
