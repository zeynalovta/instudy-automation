export async function handlePostback(userId, payload) {
  const registerUrl = createRegistrationUrl(userId);

  if (payload === "DMA_TRAININGS") {
    await supabase
      .from("instagram_contacts")
      .update({
        last_action: "DMA_TRAININGS",
        last_action_at: new Date().toISOString(),
        current_step: "viewed_trainings"
      })
      .eq("instagram_user_id", userId);

    await sendButtonTemplate(
      userId,
      TRAINING_MESSAGE,
      [
        {
          type: "web_url",
          url: registerUrl,
          title: "Qeydiyyatdan keç"
        }
      ]
    );

    return;
  }

  if (payload === "DMA_EXAM") {
    await supabase
      .from("instagram_contacts")
      .update({
        last_action: "DMA_EXAM",
        last_action_at: new Date().toISOString(),
        current_step: "viewed_exam_info"
      })
      .eq("instagram_user_id", userId);

    await sendButtonTemplate(
      userId,
      EXAM_MESSAGE,
      [
        {
          type: "web_url",
          url: registerUrl,
          title: "Qeydiyyatdan keç"
        }
      ]
    );

    return;
  }

  if (payload === "DMA_HAVE_QUESTION") {
    await supabase
      .from("instagram_contacts")
      .update({
        last_action: "DMA_HAVE_QUESTION",
        last_action_at: new Date().toISOString(),
        awaiting_operator: true,
        current_step: "waiting_operator_question"
      })
      .eq("instagram_user_id", userId);

    await sendText(
      userId,
      "Zəhmət olmasa sualınızı yazılı və ya səsli formada qeyd edin, operatorumuz tezliklə cavablandıracaq."
    );

    return;
  }

  if (payload === "DMA_REGISTERED") {
    await supabase
      .from("instagram_contacts")
      .update({
        last_action: "DMA_REGISTERED",
        last_action_at: new Date().toISOString(),
        registration_confirmed: true,
        followup_due_at: null,
        current_step: "completed"
      })
      .eq("instagram_user_id", userId);

    await sendText(
      userId,
      "Sizə uğurlar arzu edirik!"
    );

    return;
  }

  console.log("Unknown postback payload:", payload);
}
