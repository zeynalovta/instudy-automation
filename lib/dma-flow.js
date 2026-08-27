export async function startDmaFlow(
  userId,
  incomingText
) {
  // Contact-u tap / yarat və cari məlumatlarını al
  const contact = await getOrCreateContact(userId);

  const now = new Date();

  // =====================================================
  // 30 MINUTE ANTI-SPAM / COOLDOWN
  // =====================================================

  if (contact?.dma_flow_last_started_at) {
    const lastStartedAt =
      new Date(contact.dma_flow_last_started_at);

    const differenceMs =
      now.getTime() - lastStartedAt.getTime();

    const cooldownMs =
      30 * 60 * 1000;

    if (differenceMs < cooldownMs) {
      console.log(
        "DMA FLOW COOLDOWN:",
        userId,
        "Last started:",
        contact.dma_flow_last_started_at
      );

      return;
    }
  }

  const registerUrl =
    createRegistrationUrl(userId);

  // =====================================================
  // SEND MAIN DMA MESSAGE
  // =====================================================

  await sendButtonTemplate(
    userId,
    MAIN_MESSAGE,
    [
      {
        type: "web_url",
        url: registerUrl,
        title: "Qeydiyyatdan keç"
      },
      {
        type: "postback",
        title: "Hansı təlimlər var?",
        payload: "DMA_TRAININGS"
      },
      {
        type: "postback",
        title: "İmtahan barədə",
        payload: "DMA_EXAM"
      }
    ]
  );

  // =====================================================
  // FOLLOW-UP = 1 HOUR AFTER THIS FLOW START
  // =====================================================

  const followupDate =
    new Date(
      Date.now() + 60 * 60 * 1000
    ).toISOString();

  const nowIso =
    new Date().toISOString();

  const { error } = await supabase
    .from("instagram_contacts")
    .update({
      current_step: "dma_main_sent",

      registration_link_clicked: false,
      registration_confirmed: false,

      followup_sent: false,
      followup_due_at: followupDate,

      awaiting_operator: false,

      last_action: "DMA_STARTED",
      last_action_at: nowIso,

      last_incoming_text:
        incomingText,

      last_interaction_at: nowIso,

      // Anti-spam timestamp
      dma_flow_last_started_at: nowIso
    })
    .eq(
      "instagram_user_id",
      userId
    );

  if (error) {
    throw error;
  }
}
