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

import { formatDateTime, formatGold, formatItemList, formatPercent } from "./format.js";
import { formatMonitoringItem, normalizeItemName } from "./itemStore.js";

const ITEMS_PER_PAGE = 4;
const ITEM_INPUT_ID = "itemName";
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
  wizardItemPrefix: "guma:wizard-item",
  wizardNameButtonPrefix: "guma:wizard-name",
  wizardRunButtonPrefix: "guma:wizard-run",
  wizardCancelButtonPrefix: "guma:wizard-cancel",
  wizardNameModalPrefix: "guma:wizard-name-modal",
  listPagePrefix: "guma:list-page",
  listLabelPrefix: "guma:list-label",
  listDeletePrefix: "guma:list-delete",
  settingsModal: "guma:settings-modal",
};

const OLD_SETTINGS_BUTTON_IDS = new Set([
  CUSTOM_ID.statusButton,
  CUSTOM_ID.alertChannelButton,
  CUSTOM_ID.intervalButton,
  CUSTOM_ID.thresholdButton,
]);

const WIZARD_TTL_MS = 15 * 60 * 1000;
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

function truncateChoiceName(text, maxLength = 100) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function compactUiText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s"'`.,/\\|()[\]{}<>:;!?~_\-+*=]+/g, "");
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
    itemCategory: "",
    itemListName: "",
    itemSearchTerms: [],
    itemCandidates: [],
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

function normalizeItemCandidates(candidates) {
  const seen = new Set();
  const result = [];

  for (const candidate of candidates ?? []) {
    const itemName = normalizeItemName(candidate?.itemName);
    if (!itemName) {
      continue;
    }

    const key = compactUiText(itemName);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({
      itemName,
      category: normalizeItemName(candidate?.category),
      listItemName: normalizeItemName(candidate?.listItemName),
      searchTerms: Array.isArray(candidate?.searchTerms) ? candidate.searchTerms.map(normalizeItemName).filter(Boolean) : [itemName],
      pricePerUnit: Number.isFinite(candidate.pricePerUnit) ? candidate.pricePerUnit : null,
    });
  }

  return result.slice(0, 25);
}

async function updateWizardItemCandidates(state, context) {
  state.itemCandidates = [];
  if (!state.itemName || !context.mabinogiClient.hasApiKey()) {
    return [];
  }

  const candidates = await context.mabinogiClient.suggestAuctionItems(state.itemName, { limit: 25 }).catch(() => []);
  state.itemCandidates = normalizeItemCandidates(candidates);
  return state.itemCandidates;
}

function applyCandidateToWizardState(state, candidate) {
  state.itemName = candidate.itemName;
  state.itemCategory = candidate.category ?? "";
  state.itemListName = candidate.listItemName ?? "";
  state.itemSearchTerms = Array.isArray(candidate.searchTerms) ? candidate.searchTerms : [candidate.itemName];
}

function exactCandidateForItemName(state) {
  const compactName = compactUiText(state.itemName);
  return state.itemCandidates.find((candidate) => compactUiText(candidate.itemName) === compactName) ?? null;
}

function candidateOptionDescription(candidate) {
  const parts = [];
  if (candidate.category) {
    parts.push(candidate.category);
  }
  if (candidate.pricePerUnit !== null) {
    parts.push(formatGold(candidate.pricePerUnit));
  }

  return truncateChoiceName(parts.join(" · ") || "경매장 매물 확인됨", 100);
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
  return context.settingsStore.getAlertDiscountPercent(context.scopeId, getDefaultAlertDiscountPercent(context.config));
}

function buildMainPanel(context) {
  const { itemStore, settingsStore, mabinogiClient, scopeId } = context;
  const alertChannelId = settingsStore.getAlertChannelId(scopeId);
  const alertDiscountPercent = getAlertDiscountPercent(context);
  const items = itemStore.getAll(scopeId);
  const checkIntervalSeconds = Math.round(context.monitor.intervalMs / 1000);

  const embed = new EmbedBuilder()
    .setTitle("마비노기 구마봇")
    .setDescription("아래 버튼으로 이 서버의 아이템, 가격 확인, 알림 설정을 관리할 수 있습니다.")
    .setColor(0x4c6ef5)
    .addFields(
      { name: "서버 모니터링 아이템", value: items.length > 0 ? `${items.length}개 등록됨` : "아직 등록된 아이템이 없습니다.", inline: true },
      { name: "서버 알림 채널", value: alertChannelId ? `<#${alertChannelId}>` : "미설정", inline: true },
      { name: "서버 알림 기준", value: `${alertDiscountPercent}% 이상 낮을 때`, inline: true },
      { name: "체크 간격", value: `${checkIntervalSeconds}초`, inline: true },
      { name: "API 키", value: mabinogiClient.hasApiKey() ? "설정됨" : "미설정", inline: true },
    );

  const firstRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_ID.addButton).setLabel("아이템 추가").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CUSTOM_ID.listButton).setLabel("목록/삭제").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CUSTOM_ID.priceButton).setLabel("가격 검색").setStyle(ButtonStyle.Secondary),
  );

  const secondRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_ID.settingsButton).setLabel("설정/상태").setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [firstRow, secondRow] };
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

function buildWizardPanel(state, notice = "") {
  const isAdd = state.mode === "add";
  const title = isAdd ? "모니터링 아이템 추가" : "경매장 가격 검색";
  const actionLabel = isAdd ? "추가" : "검색";
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x4c6ef5)
    .setDescription(notice || "아이템명을 입력하면 경매장 매물 존재 여부를 확인합니다.")
    .addFields(
      { name: "아이템명", value: state.itemName || "미입력", inline: true },
      { name: "검증", value: state.itemCandidates.length > 0 ? "경매장 후보 확인됨" : "미확인", inline: true },
      ...(state.itemCategory ? [{ name: "자동 분류", value: state.itemCategory, inline: true }] : []),
    );

  const components = [];

  if (state.itemCandidates.length > 0) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customIdWithState(CUSTOM_ID.wizardItemPrefix, state.id))
          .setPlaceholder("경매장 후보 선택")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            state.itemCandidates.map((candidate, index) => ({
              label: truncateChoiceName(candidate.itemName),
              value: String(index),
              description: candidateOptionDescription(candidate),
              default: compactUiText(candidate.itemName) === compactUiText(state.itemName),
            })),
          ),
      ),
    );
  }

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
  const entries = context.itemStore.getEntries(context.scopeId);
  const items = entries.map(formatMonitoringItem);
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const currentPage = clampPage(page, totalPages);
  const start = currentPage * ITEMS_PER_PAGE;
  const visibleItems = items.slice(start, start + ITEMS_PER_PAGE);

  const description =
    visibleItems.length > 0
      ? "삭제할 항목의 오른쪽 삭제 버튼을 눌러 주세요."
      : "등록된 아이템이 없습니다.";

  const embed = new EmbedBuilder()
    .setTitle("서버 목록/삭제")
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

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(isAlert ? 0xe03131 : 0x2f9e44)
    .addFields(
      ...(marketData.category ? [{ name: "자동 분류", value: marketData.category, inline: true }] : []),
      { name: "최저 등록가", value: formatGold(marketData.lowestPrice), inline: true },
      { name: "기준가(차순위)", value: formatGold(marketData.nextPrice), inline: true },
      { name: "할인율", value: formatPercent(marketData.discountRate), inline: true },
      { name: "서버 알림 기준", value: `기준가 대비 ${alertDiscountPercent}% 이상 낮음`, inline: false },
    )
    .setFooter({ text: `검색 결과 ${marketData.matchingCount}개 중 최저 2개 기준` })
    .setTimestamp(new Date());
}

function buildStatusText(context) {
  const { itemStore, settingsStore, mabinogiClient, monitor, scopeId } = context;
  const status = monitor.getStatus();
  const alertChannelId = settingsStore.getAlertChannelId(scopeId);
  const alertDiscountPercent = getAlertDiscountPercent(context);

  return [
    `상태: ${status.running ? "실행 중" : "중지됨"}`,
    `서버 아이템: ${itemStore.getAll(scopeId).length}`,
    `서버 알림 채널: ${alertChannelId ? `<#${alertChannelId}>` : "미설정"}`,
    `마비노기 API 키: ${mabinogiClient.hasApiKey() ? "설정됨" : "미설정"}`,
    `체크 간격: ${Math.round(monitor.intervalMs / 1000)}초`,
    `서버 알림 기준: 기준가 대비 ${alertDiscountPercent}% 이상 낮을 때`,
    `마지막 체크: ${formatDateTime(status.lastRunAt)}`,
    `다음 체크: ${formatDateTime(status.nextRunAt)}`,
    `마지막 오류: ${status.lastError ?? "없음"}`,
  ].join("\n");
}

function formatItemValidationFailure(itemName, itemCheck) {
  return [
    `경매장에서 실제 매물을 찾지 못했습니다: ${itemName}`,
    itemCheck ? `검색 결과: ${itemCheck.rawCount}개, 이름 일치: ${itemCheck.matchingCount}개` : null,
    itemCheck?.searchKeywords?.length > 0 ? `시도한 검색어: ${itemCheck.searchKeywords.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeWizardCriteria(criteria) {
  if (typeof criteria === "string") {
    return { itemName: normalizeItemName(criteria), category: "", listItemName: "", searchTerms: [] };
  }

  return {
    itemName: normalizeItemName(criteria?.itemName),
    category: normalizeItemName(criteria?.category),
    listItemName: normalizeItemName(criteria?.listItemName),
    searchTerms: Array.isArray(criteria?.searchTerms) ? criteria.searchTerms.map(normalizeItemName).filter(Boolean) : [],
  };
}

async function runMarketSearch(interaction, context, rawCriteria) {
  const { mabinogiClient } = context;
  const inputCriteria = normalizeWizardCriteria(rawCriteria);
  const itemName = inputCriteria.itemName;

  if (!mabinogiClient.hasApiKey()) {
    await interaction.editReply("마비노기 가격 조회를 하려면 `.env`에 `API_KEY` 또는 `MABINOGI_API_KEY`를 추가해야 합니다.");
    return false;
  }

  const itemCheck = await mabinogiClient.findAuctionItem(itemName).catch(() => null);
  const criteria = itemCheck?.found
    ? {
        itemName: itemCheck.resolvedItemName,
        category: inputCriteria.category || itemCheck.category,
        listItemName: inputCriteria.listItemName || itemCheck.listItemName,
        searchTerms: inputCriteria.searchTerms.length > 0 ? inputCriteria.searchTerms : itemCheck.searchTerms,
      }
    : itemName;
  const marketData = await mabinogiClient.fetchMarketData(criteria);
  if (!marketData.found) {
    await interaction.editReply(
      [
        itemCheck?.found
          ? `실제 매물은 확인했지만 가격 비교에 필요한 매물이 2개 미만입니다: ${itemCheck.resolvedItemName}`
          : `가격 정보를 충분히 찾지 못했습니다: ${itemName}`,
        `검색 결과: ${marketData.rawCount}개, 이름 일치: ${marketData.matchingCount}개`,
        `시도한 검색어: ${marketData.searchKeywords.join(", ")}`,
      ].join("\n"),
    );
    return false;
  }

  await interaction.editReply({ embeds: [buildMarketEmbed(marketData, getAlertDiscountPercent(context))], components: [] });
  return true;
}

async function addMonitoringItem(interaction, context, rawCriteria) {
  const { itemStore, mabinogiClient, monitor, scopeId } = context;
  const inputCriteria = normalizeWizardCriteria(rawCriteria);
  const normalizedInput = inputCriteria.itemName;

  if (!normalizedInput) {
    await interaction.editReply("아이템 이름을 입력해 주세요.");
    return false;
  }

  if (!mabinogiClient.hasApiKey()) {
    await interaction.editReply("아이템명 검증을 하려면 `.env`에 `API_KEY` 또는 `MABINOGI_API_KEY`를 추가해야 합니다.");
    return false;
  }

  const itemCheck = await mabinogiClient.findAuctionItem(normalizedInput).catch((error) => ({ error }));
  if (itemCheck.error) {
    await interaction.editReply(`아이템 검증 중 오류가 발생했습니다: ${itemCheck.error.message}`);
    return false;
  }
  if (!itemCheck.found) {
    await interaction.editReply(formatItemValidationFailure(normalizedInput, itemCheck));
    return false;
  }

  const resolvedItemName = itemCheck.resolvedItemName || normalizedInput;
  const monitoringItem = {
    itemName: resolvedItemName,
    category: inputCriteria.category || itemCheck.category,
    listItemName: inputCriteria.listItemName || itemCheck.listItemName,
    searchTerms: inputCriteria.searchTerms.length > 0 ? inputCriteria.searchTerms : itemCheck.searchTerms,
  };
  const result = await itemStore.add(scopeId, monitoringItem);

  if (!result.added) {
    const suffix = result.updatedExisting ? "\n기존 목록 표기를 더 정확한 이름으로 정리했습니다." : "";
    await interaction.editReply(`이미 서버 모니터링 목록에 있습니다: ${result.existingItem ?? formatMonitoringItem(monitoringItem)}${suffix}`);
    return false;
  }

  monitor.clearCooldown(scopeId, monitoringItem);
  const resolvedNote = resolvedItemName !== normalizedInput ? `\n입력값: ${normalizedInput}\n매칭명: ${resolvedItemName}` : "";
  const scopeNote = monitoringItem.category ? `\n자동 분류: ${monitoringItem.category}` : "";
  const termsNote =
    monitoringItem.searchTerms?.length > 1 ? `\n검색 범위: ${monitoringItem.searchTerms.slice(0, 4).join(", ")}` : "";
  await interaction.editReply(
    `추가 완료: ${formatMonitoringItem(monitoringItem)}${resolvedNote}${scopeNote}${termsNote}\n\n서버 현재 목록:\n${formatItemListForReply(result.items)}`,
  );
  return true;
}

async function runWizard(interaction, context, state) {
  const itemName = normalizeItemName(state.itemName);
  if (!itemName) {
    await interaction.editReply(buildWizardPanel(state, "아이템명을 먼저 입력해 주세요."));
    return;
  }

  const criteria = {
    itemName,
    category: state.itemCategory,
    listItemName: state.itemListName,
    searchTerms: state.itemSearchTerms,
  };
  const completed =
    state.mode === "add"
      ? await addMonitoringItem(interaction, context, criteria)
      : await runMarketSearch(interaction, context, criteria);
  if (completed) {
    wizardStates.delete(state.id);
  }
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
    const itemName = context.itemStore.getEntries(context.scopeId)[index];

    if (!itemName) {
      await interaction.update(buildListPanel(context, page, "삭제할 항목을 찾지 못했습니다. 목록을 다시 열어 주세요."));
      return;
    }

    const result = await context.itemStore.removeMany(context.scopeId, [itemName]);
    for (const removedItem of result.removedItems) {
      context.monitor.clearCooldown(context.scopeId, removedItem);
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

async function handleStringSelectMenu(interaction, context) {
  const itemStateId = parseStateId(interaction.customId, CUSTOM_ID.wizardItemPrefix);
  if (itemStateId) {
    const state = getWizardState(interaction, itemStateId);
    if (!state) {
      await interaction.reply(privateReply("이 선택 UI가 만료되었습니다. `/구마`에서 다시 시작해 주세요."));
      return;
    }

    const index = Number(interaction.values[0]);
    const candidate = Number.isInteger(index) ? state.itemCandidates[index] : null;
    if (!candidate) {
      await interaction.update(buildWizardPanel(state, "선택한 후보를 찾지 못했습니다. 아이템명을 다시 입력해 주세요."));
      return;
    }

    applyCandidateToWizardState(state, candidate);
    await updateWizardItemCandidates(state, context);
    await interaction.update(buildWizardPanel(state, `경매장 후보를 선택했습니다: ${state.itemName}`));
  }
}

async function handleSettingsModalSubmit(interaction, context) {
  const { settingsStore, monitor, scopeId } = context;
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

    await settingsStore.setAlertChannelId(scopeId, interaction.channelId);
    updates.push(`알림 채널: <#${interaction.channelId}>`);
  }

  await settingsStore.setAlertDiscountPercent(scopeId, alertDiscountPercent);
  updates.push(`알림 기준: ${alertDiscountPercent}% 이상 낮을 때`);

  const intervalMs = intervalSeconds * 1000;
  await settingsStore.setCheckIntervalMs(intervalMs);
  monitor.setIntervalMs(intervalMs);
  updates.push(`체크 간격: ${intervalSeconds}초`);

  await interaction.reply(privateReply(`설정을 저장했습니다.\n${updates.join("\n")}\n\n${buildStatusText(context)}`));
}

async function handleModalSubmit(interaction, context) {
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
    state.itemCategory = "";
    state.itemListName = "";
    state.itemSearchTerms = [];
    await updateWizardItemCandidates(state, context);
    const exactCandidate = exactCandidateForItemName(state);
    if (exactCandidate) {
      applyCandidateToWizardState(state, exactCandidate);
      await respondToWizardModal(interaction, buildWizardPanel(state, `경매장 매물을 확인했습니다: ${state.itemName}`));
      return;
    }

    await respondToWizardModal(
      interaction,
      buildWizardPanel(
        state,
        state.itemCandidates.length > 0
          ? "비슷한 경매장 매물을 찾았습니다. 아래 후보에서 선택하거나 그대로 진행할 수 있습니다."
          : "아이템명을 저장했습니다. 실행 시 경매장 매물 존재 여부를 검증합니다.",
      ),
    );
  }
}

export async function handleInteraction(interaction, context) {
  const userId = interaction.user?.id;
  const scopeId = interaction.guildId ?? "global";
  const scopedContext = { ...context, userId, scopeId };

  await context.itemStore.ensureScope(scopeId);

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
