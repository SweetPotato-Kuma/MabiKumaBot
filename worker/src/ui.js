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
export const select = (customId, placeholder, options, { min = 1, max = 1 } = {}) => ({
  type: 3,
  custom_id: customId,
  placeholder,
  min_values: min,
  max_values: Math.max(1, Math.min(max, options.length)),
  options: options.slice(0, 25).map((option) => ({
    ...option,
    label: String(option.label).slice(0, 100),
    value: String(option.value).slice(0, 100),
    ...(option.description ? { description: String(option.description).slice(0, 100) } : {}),
  })),
});

/** 화면 하나. 글만 쓰는 화면과 카드(embed)를 쓰는 화면이 서로 바뀌어도 앞 화면의 것이 남지 않게 둘 다 적는다. */
export const view = (content, components = [], embeds = []) => ({
  content,
  embeds,
  components: components.filter((each) => each.components?.length > 0),
});

export const menuButton = () => button("m:menu", "← 메뉴");

export const noticeView = (text, ...buttons) => view(text, [row(...buttons, menuButton())]);

// ---------- 상호작용 응답 ----------
export const newMessage = (body, { ephemeral = true } = {}) => ({
  body: { type: CHANNEL_MESSAGE, data: { ...body, ...(ephemeral ? { flags: EPHEMERAL } : {}) } },
});
export const update = (body) => ({ body: { type: UPDATE_MESSAGE, data: body } });
/** 넥슨을 읽는 화면은 3초 안에 끝나지 않을 수 있어 먼저 "처리 중"으로 답하고 나중에 내용을 채운다. */
export const deferred = (kind, run) => ({ defer: kind, run });
export const message = (text) => newMessage(noticeView(text));

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
