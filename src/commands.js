import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import {
  AUCTION_CATEGORY_GROUPS,
  getAuctionCategoryGroup,
  resolveAuctionCategory,
  suggestAuctionCategories,
} from "./auctionCategories.js";
import { formatAuctionOptionFilters, hasAuctionOptionFilters, normalizeAuctionOptionFilters } from "./auctionFilters.js";
import { formatDateTime, formatGold, formatItemList, formatPercent } from "./format.js";
import { formatMonitoringItem, normalizeItemName } from "./itemStore.js";

const ITEMS_PER_PAGE = 4;
const ITEM_INPUT_ID = "itemName";
const CATEGORY_INPUT_ID = "categoryName";
const REFORGE_NAME_INPUT_ID = "reforgeName";
const REFORGE_MIN_INPUT_ID = "reforgeMin";
const REFORGE_MAX_INPUT_ID = "reforgeMax";
const STATUS_DISPLAY_INPUT_ID = "statusDisplay";
const USE_CURRENT_CHANNEL_INPUT_ID = "useCurrentChannel";
const INTERVAL_INPUT_ID = "intervalSeconds";
const ALERT_DISCOUNT_INPUT_ID = "alertDiscountPercent";
const MIN_INTERVAL_SECONDS = 1;
const MAX_INTERVAL_SECONDS = 3600;
const MIN_ALERT_DISCOUNT_PERCENT = 10;
const MAX_ALERT_DISCOUNT_PERCENT = 100;

const CUSTOM_ID = {
  addButton: "guma:add",
  removeButton: "guma:remove",
  listButton: "guma:list",
  settingsButton: "guma:settings",
  statusButton: "guma:status",
  alertChannelButton: "guma:alert-channel",
  intervalButton: "guma:interval",
  thresholdButton: "guma:threshold",
  priceButton: "guma:price",
  wizardGroupPrefix: "guma:wizard-group",
  wizardCategoryPrefix: "guma:wizard-category",
  wizardOptionPrefix: "guma:wizard-option",
  wizardNameButtonPrefix: "guma:wizard-name",
  wizardRunButtonPrefix: "guma:wizard-run",
  wizardCancelButtonPrefix: "guma:wizard-cancel",
  wizardNameModalPrefix: "guma:wizard-name-modal",
  wizardReforgeModalPrefix: "guma:wizard-reforge-modal",
  listPagePrefix: "guma:list-page",
  listLabelPrefix: "guma:list-label",
  listDeletePrefix: "guma:list-delete",
  addModal: "guma:add-modal",
  settingsModal: "guma:settings-modal",
  intervalModal: "guma:interval-modal",
  thresholdModal: "guma:threshold-modal",
  priceModal: "guma:price-modal",
};

const OLD_SETTINGS_BUTTON_IDS = new Set([
  CUSTOM_ID.statusButton,
  CUSTOM_ID.alertChannelButton,
  CUSTOM_ID.intervalButton,
  CUSTOM_ID.thresholdButton,
]);

const WIZARD_TTL_MS = 15 * 60 * 1000;
const WIZARD_ALL_VALUE = "__all__";
const OPTION_NONE_VALUE = "none";
const OPTION_REFORGE_VALUE = "reforge";
const wizardStates = new Map();

export const commandBuilders = [
  new SlashCommandBuilder().setName("구마").setDescription("마비노기 경매장 모니터링을 관리합니다."),
];

export const applicationCommands = commandBuilders.map((command) => command.toJSON());

function privateReply(payload) {
  if (typeof payload === "string") {
    return { content: payload, flags: MessageFlags.Ephemeral };
  }

  return { ...payload, flags: MessageFlags.Ephemeral };
}

function clampPage(page, totalPages) {
  return Math.max(0, Math.min(page, Math.max(0, totalPages - 1)));
}

function truncateButtonLabel(text, maxLength = 80) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function parsePageFromCustomId(customId, prefix) {
  const page = Number(customId.slice(prefix.length + 1));
  return Number.isInteger(page) && page >= 0 ? page : 0;
}

function parseListDeleteCustomId(customId) {
  const [, , page, index] = customId.split(":");
  return {
    page: Number.isInteger(Number(page)) ? Number(page) : 0,
    index: Number.isInteger(Number(index)) ? Number(index) : -1,
  };
}

function customIdWithState(prefix, stateId) {
  return `${prefix}:${stateId}`;
}

function parseStateId(customId, prefix) {
  return customId.startsWith(`${prefix}:`) ? customId.slice(prefix.length + 1) : null;
}

function cleanupWizardStates() {
  const now = Date.now();
  for (const [stateId, state] of wizardStates.entries()) {
    if (now - state.createdAt > WIZARD_TTL_MS) {
      wizardStates.delete(stateId);
    }
  }
}

function createWizardState(userId, mode) {
  cleanupWizardStates();
  const stateId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const state = {
    id: stateId,
    userId,
    mode,
    itemName: "",
    categoryGroup: "",
    category: "",
    optionFilters: {},
    createdAt: Date.now(),
  };
  wizardStates.set(stateId, state);
  return state;
}

function getWizardState(interaction, stateId) {
  cleanupWizardStates();
  const state = wizardStates.get(stateId);
  if (!state || state.userId !== interaction.user?.id) {
    return null;
  }

  return state;
}

function selectedCategoryText(state) {
  if (!state.category) {
    return "전체";
  }

  if (state.categoryGroup && state.category === state.categoryGroup) {
    return formatGroupAllLabel(state.categoryGroup);
  }

  return state.category;
}

function selectedOptionText(state) {
  return formatAuctionOptionFilters(state.optionFilters);
}

function formatGroupAllLabel(groupName) {
  const normalized = String(groupName ?? "").trim();
  return normalized.endsWith("전체") ? normalized : `${normalized} 전체`;
}

async function respondToWizardModal(interaction, panel) {
  if (interaction.isFromMessage()) {
    await interaction.update(panel);
    return;
  }

  await interaction.reply(privateReply(panel));
}

function truncateText(text, maxLength = 3900) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 40)}\n...생략됨`;
}

function formatItemListForReply(items) {
  return truncateText(formatItemList(items), 1700);
}

function getDefaultAlertDiscountPercent(config) {
  const percent = Math.round(Number(config.alertDiscountThreshold) * 100);
  return Number.isInteger(percent) && percent >= MIN_ALERT_DISCOUNT_PERCENT && percent <= MAX_ALERT_DISCOUNT_PERCENT
    ? percent
    : MIN_ALERT_DISCOUNT_PERCENT;
}

function getAlertDiscountPercent(context) {
  return context.settingsStore.getAlertDiscountPercent(context.userId, getDefaultAlertDiscountPercent(context.config));
}

function buildMainPanel(context) {
  const { itemStore, settingsStore, mabinogiClient, userId } = context;
  const alertChannelId = settingsStore.getAlertChannelId(userId);
  const alertDiscountPercent = getAlertDiscountPercent(context);
  const items = itemStore.getAll(userId);
  const checkIntervalSeconds = Math.round(context.monitor.intervalMs / 1000);

  const embed = new EmbedBuilder()
    .setTitle("마비노기 구마봇")
    .setDescription("아래 버튼으로 내 아이템, 가격 확인, 알림 설정을 관리할 수 있습니다.")
    .setColor(0x4c6ef5)
    .addFields(
      { name: "내 모니터링 아이템", value: items.length > 0 ? `${items.length}개 등록됨` : "아직 등록된 아이템이 없습니다.", inline: true },
      { name: "내 알림 채널", value: alertChannelId ? `<#${alertChannelId}>` : "미설정", inline: true },
      { name: "내 알림 기준", value: `${alertDiscountPercent}% 이상 낮을 때`, inline: true },
      { name: "체크 간격", value: `${checkIntervalSeconds}초`, inline: true },
      { name: "API 키", value: mabinogiClient.hasApiKey() ? "설정됨" : "미설정", inline: true },
    );

  const firstRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_ID.addButton).setLabel("아이템 추가").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CUSTOM_ID.listButton).setLabel("목록/삭제").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CUSTOM_ID.priceButton).setLabel("가격/카테고리").setStyle(ButtonStyle.Secondary),
  );

  const secondRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_ID.settingsButton).setLabel("설정/상태").setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [firstRow, secondRow] };
}

function buildItemModal({ customId, title, label, placeholder }) {
  const input = new TextInputBuilder()
    .setCustomId(ITEM_INPUT_ID)
    .setLabel(label)
    .setPlaceholder(placeholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function buildPriceModal() {
  const itemInput = new TextInputBuilder()
    .setCustomId(ITEM_INPUT_ID)
    .setLabel("확인할 아이템 이름")
    .setPlaceholder("예: 마나허브")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const categoryInput = new TextInputBuilder()
    .setCustomId(CATEGORY_INPUT_ID)
    .setLabel("카테고리(선택)")
    .setPlaceholder("예: 허브, 소모품, 인챈트 스크롤")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(40);

  return new ModalBuilder()
    .setCustomId(CUSTOM_ID.priceModal)
    .setTitle("경매장 가격/카테고리 확인")
    .addComponents(new ActionRowBuilder().addComponents(itemInput), new ActionRowBuilder().addComponents(categoryInput));
}

function buildWizardItemNameModal(state) {
  const input = new TextInputBuilder()
    .setCustomId(ITEM_INPUT_ID)
    .setLabel("아이템 이름")
    .setPlaceholder("예: 마나허브")
    .setValue(state.itemName)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  return new ModalBuilder()
    .setCustomId(customIdWithState(CUSTOM_ID.wizardNameModalPrefix, state.id))
    .setTitle(state.mode === "add" ? "추가할 아이템 입력" : "검색할 아이템 입력")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function buildReforgeModal(state) {
  const reforge = normalizeAuctionOptionFilters(state.optionFilters).reforge ?? { name: "", min: null, max: null };
  const nameInput = new TextInputBuilder()
    .setCustomId(REFORGE_NAME_INPUT_ID)
    .setLabel("세공 옵션명")
    .setPlaceholder("예: 최대 공격력, 마법 공격력")
    .setValue(reforge.name)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);

  const minInput = new TextInputBuilder()
    .setCustomId(REFORGE_MIN_INPUT_ID)
    .setLabel("최소값(선택)")
    .setPlaceholder("예: 18")
    .setValue(reforge.min === null ? "" : String(reforge.min))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  const maxInput = new TextInputBuilder()
    .setCustomId(REFORGE_MAX_INPUT_ID)
    .setLabel("최대값(선택)")
    .setPlaceholder("예: 20")
    .setValue(reforge.max === null ? "" : String(reforge.max))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  return new ModalBuilder()
    .setCustomId(customIdWithState(CUSTOM_ID.wizardReforgeModalPrefix, state.id))
    .setTitle("세공 옵션 필터")
    .addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(minInput),
      new ActionRowBuilder().addComponents(maxInput),
    );
}

function buildWizardPanel(state, notice = "") {
  const isAdd = state.mode === "add";
  const title = isAdd ? "모니터링 아이템 추가" : "경매장 가격/카테고리 검색";
  const actionLabel = isAdd ? "추가" : "검색";
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x4c6ef5)
    .setDescription(notice || "상위 카테고리와 하위 카테고리를 고른 뒤 아이템명을 입력해 주세요.")
    .addFields(
      { name: "아이템명", value: state.itemName || "미입력", inline: true },
      { name: "카테고리", value: selectedCategoryText(state), inline: true },
      { name: "추가 옵션", value: selectedOptionText(state), inline: false },
    );

  const groupOptions = [
    {
      label: "전체",
      value: WIZARD_ALL_VALUE,
      description: "카테고리 제한 없이 검색",
      default: !state.categoryGroup && !state.category,
    },
    ...AUCTION_CATEGORY_GROUPS.map((group) => ({
      label: group.name,
      value: group.name,
      description: truncateButtonLabel(group.categories.slice(0, 4).join(", "), 100),
      default: state.categoryGroup === group.name,
    })),
  ];

  const components = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(customIdWithState(CUSTOM_ID.wizardGroupPrefix, state.id))
        .setPlaceholder("상위 카테고리 선택")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(groupOptions),
    ),
  ];

  const group = getAuctionCategoryGroup(state.categoryGroup);
  if (group) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customIdWithState(CUSTOM_ID.wizardCategoryPrefix, state.id))
          .setPlaceholder("하위 카테고리 선택")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions([
            {
              label: formatGroupAllLabel(group.name),
              value: group.name,
              description: "이 상위 카테고리의 모든 하위 카테고리",
              default: state.category === group.name,
            },
            ...group.categories.map((category) => ({
              label: category,
              value: category,
              default: state.category === category,
            })),
          ]),
      ),
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(customIdWithState(CUSTOM_ID.wizardOptionPrefix, state.id))
        .setPlaceholder("추가 옵션 선택")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          {
            label: "추가 옵션 없음",
            value: OPTION_NONE_VALUE,
            description: "카테고리와 아이템명만 사용",
            default: !hasAuctionOptionFilters(state.optionFilters),
          },
          {
            label: "세공 옵션",
            value: OPTION_REFORGE_VALUE,
            description: "세공 옵션명과 수치 범위로 결과 필터링",
            default: Boolean(normalizeAuctionOptionFilters(state.optionFilters).reforge),
          },
        ),
    ),
  );

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(customIdWithState(CUSTOM_ID.wizardNameButtonPrefix, state.id))
        .setLabel("아이템명 입력")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(customIdWithState(CUSTOM_ID.wizardRunButtonPrefix, state.id))
        .setLabel(actionLabel)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!state.itemName),
      new ButtonBuilder()
        .setCustomId(customIdWithState(CUSTOM_ID.wizardCancelButtonPrefix, state.id))
        .setLabel("취소")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

function buildListPanel(context, page = 0, notice = "") {
  const items = context.itemStore.getAll(context.userId);
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const currentPage = clampPage(page, totalPages);
  const start = currentPage * ITEMS_PER_PAGE;
  const visibleItems = items.slice(start, start + ITEMS_PER_PAGE);

  const description =
    visibleItems.length > 0
      ? "삭제할 항목의 오른쪽 삭제 버튼을 눌러 주세요."
      : "등록된 아이템이 없습니다.";

  const embed = new EmbedBuilder()
    .setTitle("내 목록/삭제")
    .setDescription(description)
    .setColor(0x4c6ef5)
    .setFooter({ text: `${items.length}개 등록됨 · ${currentPage + 1}/${totalPages} 페이지` });

  if (notice) {
    embed.addFields({ name: "처리 결과", value: notice });
  }

  const components = visibleItems.map((item, index) => {
    const absoluteIndex = start + index;
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID.listLabelPrefix}:${currentPage}:${absoluteIndex}`)
        .setLabel(truncateButtonLabel(`${absoluteIndex + 1}. ${item}`, 70))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID.listDeletePrefix}:${currentPage}:${absoluteIndex}`)
        .setLabel("삭제")
        .setStyle(ButtonStyle.Danger),
    );
  });

  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID.listPagePrefix}:${currentPage - 1}`)
          .setLabel("이전")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID.listPagePrefix}:${currentPage + 1}`)
          .setLabel("다음")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage >= totalPages - 1),
      ),
    );
  }

  return { embeds: [embed], components };
}

function buildSettingsModal(context) {
  const alertDiscountPercent = getAlertDiscountPercent(context);
  const intervalSeconds = Math.round(context.monitor.intervalMs / 1000);

  const statusDisplay = new TextInputBuilder()
    .setCustomId(STATUS_DISPLAY_INPUT_ID)
    .setLabel("현재 상태(보기용)")
    .setValue(truncateText(buildStatusText(context)))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000);

  const useCurrentChannel = new TextInputBuilder()
    .setCustomId(USE_CURRENT_CHANNEL_INPUT_ID)
    .setLabel("현재 채널 알림 설정(Y/N)")
    .setPlaceholder("Y 입력 시 이 채널로 알림")
    .setValue("N")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(1);

  const alertDiscountInput = new TextInputBuilder()
    .setCustomId(ALERT_DISCOUNT_INPUT_ID)
    .setLabel("알림 기준 할인율(10~100)")
    .setPlaceholder("예: 10")
    .setValue(String(alertDiscountPercent))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(3);

  const intervalInput = new TextInputBuilder()
    .setCustomId(INTERVAL_INPUT_ID)
    .setLabel("체크 간격(초)")
    .setPlaceholder("예: 10")
    .setValue(String(intervalSeconds))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(4);

  return new ModalBuilder()
    .setCustomId(CUSTOM_ID.settingsModal)
    .setTitle("설정/상태")
    .addComponents(
      new ActionRowBuilder().addComponents(statusDisplay),
      new ActionRowBuilder().addComponents(useCurrentChannel),
      new ActionRowBuilder().addComponents(alertDiscountInput),
      new ActionRowBuilder().addComponents(intervalInput),
    );
}

function buildMarketEmbed(marketData, alertDiscountPercent) {
  const alertDiscountRate = alertDiscountPercent / 100;
  const isAlert = marketData.discountRate >= alertDiscountRate;
  const title =
    marketData.resolvedItemName && marketData.resolvedItemName !== marketData.itemName
      ? `경매장 가격 확인: ${marketData.itemName} -> ${marketData.resolvedItemName}`
      : `경매장 가격 확인: ${marketData.itemName}`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(isAlert ? 0xe03131 : 0x2f9e44)
    .addFields(
      { name: "카테고리", value: marketData.category || marketData.lowestItem.category || "전체", inline: true },
      { name: "최저 등록가", value: formatGold(marketData.lowestPrice), inline: true },
      { name: "기준가(차순위)", value: formatGold(marketData.nextPrice), inline: true },
      { name: "할인율", value: formatPercent(marketData.discountRate), inline: true },
      { name: "내 알림 기준", value: `기준가 대비 ${alertDiscountPercent}% 이상 낮음`, inline: false },
    )
    .setFooter({ text: `검색 결과 ${marketData.matchingCount}개 중 최저 2개 기준` })
    .setTimestamp(new Date());

  if (hasAuctionOptionFilters(marketData.optionFilters)) {
    embed.addFields({ name: "추가 옵션", value: formatAuctionOptionFilters(marketData.optionFilters), inline: false });
  }

  return embed;
}

function buildStatusText(context) {
  const { itemStore, settingsStore, mabinogiClient, monitor, userId } = context;
  const status = monitor.getStatus();
  const alertChannelId = settingsStore.getAlertChannelId(userId);
  const alertDiscountPercent = getAlertDiscountPercent(context);

  return [
    `상태: ${status.running ? "실행 중" : "중지됨"}`,
    `내 아이템: ${itemStore.getAll(userId).length}`,
    `내 알림 채널: ${alertChannelId ? `<#${alertChannelId}>` : "미설정"}`,
    `마비노기 API 키: ${mabinogiClient.hasApiKey() ? "설정됨" : "미설정"}`,
    `체크 간격: ${Math.round(monitor.intervalMs / 1000)}초`,
    `내 알림 기준: 기준가 대비 ${alertDiscountPercent}% 이상 낮을 때`,
    `마지막 체크: ${formatDateTime(status.lastRunAt)}`,
    `다음 체크: ${formatDateTime(status.nextRunAt)}`,
    `마지막 오류: ${status.lastError ?? "없음"}`,
  ].join("\n");
}

async function addMonitoringItem(interaction, context, criteria) {
  const { itemStore, mabinogiClient, monitor, userId } = context;
  const rawItemName = typeof criteria === "string" ? criteria : criteria.itemName;
  const normalizedInput = normalizeItemName(rawItemName);
  const category = typeof criteria === "string" ? "" : criteria.category ?? "";
  const optionFilters = typeof criteria === "string" ? {} : normalizeAuctionOptionFilters(criteria.optionFilters);

  if (!normalizedInput) {
    await interaction.editReply("아이템 이름을 입력해 주세요.");
    return;
  }

  let resolvedItemName = normalizedInput;
  if (mabinogiClient.hasApiKey()) {
    const marketData = await mabinogiClient.fetchMarketData(normalizedInput, { category, optionFilters }).catch(() => null);
    resolvedItemName = marketData?.resolvedItemName || (await mabinogiClient.resolveItemName(normalizedInput));
  }

  const monitoringItem = { itemName: resolvedItemName, category, optionFilters };
  const result = await itemStore.add(userId, monitoringItem);

  if (!result.added) {
    const suffix = result.updatedExisting ? "\n기존 목록 표기를 더 정확한 이름으로 정리했습니다." : "";
    await interaction.editReply(`이미 내 모니터링 목록에 있습니다: ${result.existingItem ?? resolvedItemName}${suffix}`);
    return;
  }

  monitor.clearCooldown(userId, monitoringItem);
  const itemLabel = formatMonitoringItem(monitoringItem);
  const resolvedNote = resolvedItemName !== normalizedInput ? `\n입력값: ${normalizedInput}\n매칭명: ${resolvedItemName}` : "";
  await interaction.editReply(`추가 완료: ${itemLabel}${resolvedNote}\n\n내 현재 목록:\n${formatItemListForReply(result.items)}`);
}

async function runWizard(interaction, context, state) {
  const { mabinogiClient } = context;
  const itemName = normalizeItemName(state.itemName);
  const category = state.category || "";
  const optionFilters = normalizeAuctionOptionFilters(state.optionFilters);

  if (!itemName) {
    await interaction.editReply(buildWizardPanel(state, "아이템명을 먼저 입력해 주세요."));
    return;
  }

  if (state.mode === "add") {
    await addMonitoringItem(interaction, context, { itemName, category, optionFilters });
    wizardStates.delete(state.id);
    return;
  }

  if (!mabinogiClient.hasApiKey()) {
    await interaction.editReply("마비노기 가격 조회를 하려면 `.env`에 `API_KEY` 또는 `MABINOGI_API_KEY`를 추가해야 합니다.");
    return;
  }

  const marketData = await mabinogiClient.fetchMarketData(itemName, { category, optionFilters });
  if (!marketData.found) {
    await interaction.editReply(
      [
        `가격 정보를 충분히 찾지 못했습니다: ${itemName}`,
        marketData.category ? `카테고리: ${marketData.category}` : null,
        hasAuctionOptionFilters(marketData.optionFilters) ? `추가 옵션: ${formatAuctionOptionFilters(marketData.optionFilters)}` : null,
        `검색 결과: ${marketData.rawCount}개, 이름 일치: ${marketData.matchingCount}개`,
        `시도한 검색어: ${marketData.searchKeywords.join(", ")}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return;
  }

  wizardStates.delete(state.id);
  await interaction.editReply({ embeds: [buildMarketEmbed(marketData, getAlertDiscountPercent(context))], components: [] });
}

async function handleChatInputCommand(interaction, context) {
  if (interaction.commandName !== "구마") {
    return;
  }

  await interaction.reply(privateReply(buildMainPanel(context)));
}

async function handleButton(interaction, context) {
  if (interaction.customId === CUSTOM_ID.addButton) {
    const state = createWizardState(context.userId, "add");
    await interaction.reply(privateReply(buildWizardPanel(state)));
    return;
  }

  const nameStateId = parseStateId(interaction.customId, CUSTOM_ID.wizardNameButtonPrefix);
  if (nameStateId) {
    const state = getWizardState(interaction, nameStateId);
    if (!state) {
      await interaction.reply(privateReply("이 선택 UI가 만료되었습니다. `/구마`에서 다시 시작해 주세요."));
      return;
    }

    await interaction.showModal(buildWizardItemNameModal(state));
    return;
  }

  const runStateId = parseStateId(interaction.customId, CUSTOM_ID.wizardRunButtonPrefix);
  if (runStateId) {
    const state = getWizardState(interaction, runStateId);
    if (!state) {
      await interaction.reply(privateReply("이 선택 UI가 만료되었습니다. `/구마`에서 다시 시작해 주세요."));
      return;
    }

    await interaction.deferUpdate();
    await runWizard(interaction, context, state);
    return;
  }

  const cancelStateId = parseStateId(interaction.customId, CUSTOM_ID.wizardCancelButtonPrefix);
  if (cancelStateId) {
    const state = getWizardState(interaction, cancelStateId);
    if (state) {
      wizardStates.delete(state.id);
    }

    await interaction.update({ content: "작업을 취소했습니다.", embeds: [], components: [] });
    return;
  }

  if (interaction.customId === CUSTOM_ID.listButton || interaction.customId === CUSTOM_ID.removeButton) {
    await interaction.reply(privateReply(buildListPanel(context)));
    return;
  }

  if (interaction.customId === CUSTOM_ID.settingsButton || OLD_SETTINGS_BUTTON_IDS.has(interaction.customId)) {
    await interaction.showModal(buildSettingsModal(context));
    return;
  }

  if (interaction.customId.startsWith(`${CUSTOM_ID.listPagePrefix}:`)) {
    const page = parsePageFromCustomId(interaction.customId, CUSTOM_ID.listPagePrefix);
    await interaction.update(buildListPanel(context, page));
    return;
  }

  if (interaction.customId.startsWith(`${CUSTOM_ID.listDeletePrefix}:`)) {
    const { page, index } = parseListDeleteCustomId(interaction.customId);
    const itemName = context.itemStore.getAll(context.userId)[index];

    if (!itemName) {
      await interaction.update(buildListPanel(context, page, "삭제할 항목을 찾지 못했습니다. 목록을 다시 열어 주세요."));
      return;
    }

    const result = await context.itemStore.removeMany(context.userId, [itemName]);
    for (const removedItem of result.removedEntries ?? result.removedItems) {
      context.monitor.clearCooldown(context.userId, removedItem);
    }

    const totalPages = Math.max(1, Math.ceil(result.items.length / ITEMS_PER_PAGE));
    const nextPage = clampPage(page, totalPages);
    const notice = result.removed ? `삭제 완료: ${result.removedItems.join(", ")}` : "삭제할 항목을 찾지 못했습니다.";
    await interaction.update(buildListPanel(context, nextPage, notice));
    return;
  }

  if (interaction.customId === CUSTOM_ID.priceButton) {
    const state = createWizardState(context.userId, "price");
    await interaction.reply(privateReply(buildWizardPanel(state)));
  }
}

async function handleStringSelectMenu(interaction) {
  const groupStateId = parseStateId(interaction.customId, CUSTOM_ID.wizardGroupPrefix);
  if (groupStateId) {
    const state = getWizardState(interaction, groupStateId);
    if (!state) {
      await interaction.reply(privateReply("이 선택 UI가 만료되었습니다. `/구마`에서 다시 시작해 주세요."));
      return;
    }

    const selected = interaction.values[0];
    if (selected === WIZARD_ALL_VALUE) {
      state.categoryGroup = "";
      state.category = "";
    } else {
      state.categoryGroup = selected;
      state.category = selected;
    }

    await interaction.update(buildWizardPanel(state));
    return;
  }

  const categoryStateId = parseStateId(interaction.customId, CUSTOM_ID.wizardCategoryPrefix);
  if (categoryStateId) {
    const state = getWizardState(interaction, categoryStateId);
    if (!state) {
      await interaction.reply(privateReply("이 선택 UI가 만료되었습니다. `/구마`에서 다시 시작해 주세요."));
      return;
    }

    state.category = interaction.values[0] ?? state.category;
    await interaction.update(buildWizardPanel(state));
    return;
  }

  const optionStateId = parseStateId(interaction.customId, CUSTOM_ID.wizardOptionPrefix);
  if (optionStateId) {
    const state = getWizardState(interaction, optionStateId);
    if (!state) {
      await interaction.reply(privateReply("이 선택 UI가 만료되었습니다. `/구마`에서 다시 시작해 주세요."));
      return;
    }

    const selected = interaction.values[0];
    if (selected === OPTION_NONE_VALUE) {
      state.optionFilters = {};
      await interaction.update(buildWizardPanel(state));
      return;
    }

    if (selected === OPTION_REFORGE_VALUE) {
      await interaction.showModal(buildReforgeModal(state));
    }
  }
}

async function handleSettingsModalSubmit(interaction, context) {
  const { settingsStore, monitor, userId } = context;
  const rawUseCurrentChannel = interaction.fields.getTextInputValue(USE_CURRENT_CHANNEL_INPUT_ID).trim().toUpperCase();
  const rawPercent = interaction.fields.getTextInputValue(ALERT_DISCOUNT_INPUT_ID).trim();
  const rawSeconds = interaction.fields.getTextInputValue(INTERVAL_INPUT_ID).trim();
  const alertDiscountPercent = Number(rawPercent);
  const intervalSeconds = Number(rawSeconds);

  if (!["", "N", "Y"].includes(rawUseCurrentChannel)) {
    await interaction.reply(privateReply("현재 채널 알림 설정은 Y 또는 N으로 입력해 주세요."));
    return;
  }

  if (
    !Number.isInteger(alertDiscountPercent) ||
    alertDiscountPercent < MIN_ALERT_DISCOUNT_PERCENT ||
    alertDiscountPercent > MAX_ALERT_DISCOUNT_PERCENT
  ) {
    await interaction.reply(
      privateReply(`알림 기준은 ${MIN_ALERT_DISCOUNT_PERCENT}부터 ${MAX_ALERT_DISCOUNT_PERCENT}까지의 정수로 입력해 주세요.`),
    );
    return;
  }

  if (!Number.isInteger(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS || intervalSeconds > MAX_INTERVAL_SECONDS) {
    await interaction.reply(
      privateReply(`체크 간격은 ${MIN_INTERVAL_SECONDS}초부터 ${MAX_INTERVAL_SECONDS}초까지의 정수로 입력해 주세요.`),
    );
    return;
  }

  const updates = [];

  if (rawUseCurrentChannel === "Y") {
    if (!interaction.channel?.isTextBased()) {
      await interaction.reply(privateReply("텍스트를 보낼 수 있는 채널에서만 알림 채널을 설정할 수 있습니다."));
      return;
    }

    await settingsStore.setAlertChannelId(userId, interaction.channelId);
    updates.push(`알림 채널: <#${interaction.channelId}>`);
  }

  await settingsStore.setAlertDiscountPercent(userId, alertDiscountPercent);
  updates.push(`알림 기준: ${alertDiscountPercent}% 이상 낮을 때`);

  const intervalMs = intervalSeconds * 1000;
  await settingsStore.setCheckIntervalMs(intervalMs);
  monitor.setIntervalMs(intervalMs);
  updates.push(`체크 간격: ${intervalSeconds}초`);

  await interaction.reply(privateReply(`설정을 저장했습니다.\n${updates.join("\n")}\n\n${buildStatusText(context)}`));
}

async function handleModalSubmit(interaction, context) {
  const { mabinogiClient } = context;

  if (interaction.customId === CUSTOM_ID.settingsModal) {
    await handleSettingsModalSubmit(interaction, context);
    return;
  }

  const wizardNameStateId = parseStateId(interaction.customId, CUSTOM_ID.wizardNameModalPrefix);
  if (wizardNameStateId) {
    const state = getWizardState(interaction, wizardNameStateId);
    if (!state) {
      await interaction.reply(privateReply("이 선택 UI가 만료되었습니다. `/구마`에서 다시 시작해 주세요."));
      return;
    }

    state.itemName = normalizeItemName(interaction.fields.getTextInputValue(ITEM_INPUT_ID));
    await respondToWizardModal(interaction, buildWizardPanel(state, "아이템명을 저장했습니다."));
    return;
  }

  const wizardReforgeStateId = parseStateId(interaction.customId, CUSTOM_ID.wizardReforgeModalPrefix);
  if (wizardReforgeStateId) {
    const state = getWizardState(interaction, wizardReforgeStateId);
    if (!state) {
      await interaction.reply(privateReply("이 선택 UI가 만료되었습니다. `/구마`에서 다시 시작해 주세요."));
      return;
    }

    const name = interaction.fields.getTextInputValue(REFORGE_NAME_INPUT_ID).trim().replace(/\s+/g, " ");
    const rawMin = interaction.fields.getTextInputValue(REFORGE_MIN_INPUT_ID).trim();
    const rawMax = interaction.fields.getTextInputValue(REFORGE_MAX_INPUT_ID).trim();
    const min = rawMin ? Number(rawMin) : null;
    const max = rawMax ? Number(rawMax) : null;

    if ((rawMin && !Number.isFinite(min)) || (rawMax && !Number.isFinite(max))) {
      await interaction.reply(privateReply("세공 옵션 최소값/최대값은 숫자로 입력해 주세요."));
      return;
    }

    state.optionFilters = normalizeAuctionOptionFilters({
      ...state.optionFilters,
      reforge: { name, min, max },
    });
    await respondToWizardModal(interaction, buildWizardPanel(state, "세공 옵션을 저장했습니다."));
    return;
  }

  if (interaction.customId === CUSTOM_ID.addModal) {
    const itemName = normalizeItemName(interaction.fields.getTextInputValue(ITEM_INPUT_ID));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await addMonitoringItem(interaction, context, itemName);
    return;
  }

  if (interaction.customId === CUSTOM_ID.priceModal) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const itemName = normalizeItemName(interaction.fields.getTextInputValue(ITEM_INPUT_ID));
    const categoryInput = interaction.fields.getTextInputValue(CATEGORY_INPUT_ID).trim().replace(/\s+/g, " ");

    if (!mabinogiClient.hasApiKey()) {
      await interaction.editReply("마비노기 가격 조회를 하려면 `.env`에 `API_KEY` 또는 `MABINOGI_API_KEY`를 추가해야 합니다.");
      return;
    }

    if (!itemName) {
      await interaction.editReply("아이템 이름을 입력해 주세요.");
      return;
    }

    const resolvedCategory = resolveAuctionCategory(categoryInput);
    if (categoryInput && !resolvedCategory) {
      const suggestions = suggestAuctionCategories(categoryInput);
      await interaction.editReply(
        [
          `카테고리를 찾지 못했습니다: ${categoryInput}`,
          suggestions.length > 0 ? `비슷한 카테고리: ${suggestions.join(", ")}` : "예: 허브, 소모품, 인챈트 스크롤, 근거리 장비",
        ].join("\n"),
      );
      return;
    }

    const marketData = await mabinogiClient.fetchMarketData(itemName, { category: categoryInput });
    if (!marketData.found) {
      await interaction.editReply(
        [
          `가격 정보를 충분히 찾지 못했습니다: ${itemName}`,
          marketData.category ? `카테고리: ${marketData.category}` : null,
          `검색 결과: ${marketData.rawCount}개, 이름 일치: ${marketData.matchingCount}개`,
          `시도한 검색어: ${marketData.searchKeywords.join(", ")}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
      return;
    }

    await interaction.editReply({ embeds: [buildMarketEmbed(marketData, getAlertDiscountPercent(context))] });
  }
}

export async function handleInteraction(interaction, context) {
  const userId = interaction.user?.id;
  const scopedContext = { ...context, userId };

  if (userId) {
    await context.itemStore.ensureUser(userId);
  }

  if (interaction.isChatInputCommand()) {
    await handleChatInputCommand(interaction, scopedContext);
    return;
  }

  if (interaction.isButton()) {
    await handleButton(interaction, scopedContext);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    await handleStringSelectMenu(interaction, scopedContext);
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction, scopedContext);
  }
}
