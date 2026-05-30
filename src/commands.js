import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";

import { formatDateTime, formatGold, formatItemList, formatPercent } from "./format.js";
import { normalizeItemName } from "./itemStore.js";

const ITEM_OPTION_NAME = "아이템";

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("추가")
    .setDescription("마비노기 경매장 모니터링 아이템을 추가합니다.")
    .addStringOption((option) => option.setName(ITEM_OPTION_NAME).setDescription("추가할 아이템 이름").setRequired(true)),
  new SlashCommandBuilder()
    .setName("제거")
    .setDescription("마비노기 경매장 모니터링 아이템을 제거합니다.")
    .addStringOption((option) => option.setName(ITEM_OPTION_NAME).setDescription("제거할 아이템 이름").setRequired(true)),
  new SlashCommandBuilder().setName("목록").setDescription("현재 모니터링 중인 아이템 목록을 봅니다."),
  new SlashCommandBuilder().setName("상태").setDescription("봇과 모니터링 루프 상태를 확인합니다."),
  new SlashCommandBuilder()
    .setName("가격확인")
    .setDescription("아이템의 현재 경매장 최저가와 차순위 가격을 확인합니다.")
    .addStringOption((option) => option.setName(ITEM_OPTION_NAME).setDescription("확인할 아이템 이름").setRequired(true)),
];

export const applicationCommands = commandBuilders.map((command) => command.toJSON());

function privateReply(payload) {
  if (typeof payload === "string") {
    return { content: payload, flags: MessageFlags.Ephemeral };
  }

  return { ...payload, flags: MessageFlags.Ephemeral };
}

function buildMarketEmbed(marketData, threshold) {
  const isAlert = marketData.lowestPrice <= marketData.nextPrice * threshold;
  return new EmbedBuilder()
    .setTitle(`경매장 가격 확인: ${marketData.itemName}`)
    .setColor(isAlert ? 0xe03131 : 0x2f9e44)
    .addFields(
      { name: "최저 등록가", value: formatGold(marketData.lowestPrice), inline: true },
      { name: "차순위 가격", value: formatGold(marketData.nextPrice), inline: true },
      { name: "할인율", value: formatPercent(marketData.discountRate), inline: true },
      { name: "알림 기준", value: `최저가가 차순위의 ${formatPercent(threshold)} 이하`, inline: false },
    )
    .setFooter({ text: `검색 결과 ${marketData.matchingCount}개 중 최저 2개 기준` })
    .setTimestamp(new Date());
}

export async function handleInteraction(interaction, context) {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const { commandName } = interaction;
  const { itemStore, mabinogiClient, monitor, config } = context;

  if (commandName === "추가") {
    const itemName = normalizeItemName(interaction.options.getString(ITEM_OPTION_NAME, true));
    const result = await itemStore.add(itemName);

    if (!result.added) {
      const message = result.reason === "duplicate" ? `이미 모니터링 중입니다: ${itemName}` : "아이템 이름을 입력해 주세요.";
      await interaction.reply(privateReply(message));
      return;
    }

    monitor.clearCooldown(itemName);
    await interaction.reply(privateReply(`추가 완료: ${itemName}\n\n현재 목록:\n${formatItemList(result.items)}`));
    return;
  }

  if (commandName === "제거") {
    const itemName = normalizeItemName(interaction.options.getString(ITEM_OPTION_NAME, true));
    const result = await itemStore.remove(itemName);

    if (!result.removed) {
      await interaction.reply(privateReply(`목록에 없는 아이템입니다: ${itemName}`));
      return;
    }

    monitor.clearCooldown(itemName);
    await interaction.reply(privateReply(`제거 완료: ${itemName}\n\n현재 목록:\n${formatItemList(result.items)}`));
    return;
  }

  if (commandName === "목록") {
    await interaction.reply(privateReply(`현재 모니터링 중인 아이템:\n${formatItemList(itemStore.getAll())}`));
    return;
  }

  if (commandName === "상태") {
    const status = monitor.getStatus();
    await interaction.reply(
      privateReply(
        [
          `상태: ${status.running ? "실행 중" : "중지됨"}`,
          `아이템 수: ${itemStore.getAll().length}`,
          `체크 간격: ${Math.round(config.checkIntervalMs / 1000)}초`,
          `알림 기준: 차순위 가격의 ${formatPercent(config.alertDiscountThreshold)} 이하`,
          `마지막 체크: ${formatDateTime(status.lastRunAt)}`,
          `다음 체크: ${formatDateTime(status.nextRunAt)}`,
          `마지막 오류: ${status.lastError ?? "없음"}`,
        ].join("\n"),
      ),
    );
    return;
  }

  if (commandName === "가격확인") {
    const itemName = normalizeItemName(interaction.options.getString(ITEM_OPTION_NAME, true));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const marketData = await mabinogiClient.fetchMarketData(itemName);
    if (!marketData.found) {
      await interaction.editReply(
        `가격 정보를 충분히 찾지 못했습니다: ${itemName}\n검색 결과: ${marketData.rawCount}개, 이름 일치: ${marketData.matchingCount}개`,
      );
      return;
    }

    await interaction.editReply({ embeds: [buildMarketEmbed(marketData, config.alertDiscountThreshold)] });
  }
}

