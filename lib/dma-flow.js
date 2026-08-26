async function getInstagramProfile(userId) {
  try {
    const response = await fetch(
      `https://graph.instagram.com/v26.0/${userId}?fields=name,username&access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "Instagram profile API error:",
        JSON.stringify(data)
      );

      return {
        username: null,
        name: null
      };
    }

    return {
      username: data.username || null,
      name: data.name || null
    };

  } catch (error) {
    console.error(
      "Instagram profile fetch error:",
      error
    );

    return {
      username: null,
      name: null
    };
  }
}

async function getOrCreateContact(userId) {
  const { data: existing, error: findError } = await supabase
    .from("instagram_contacts")
    .select("*")
    .eq("instagram_user_id", userId)
    .maybeSingle();

  if (findError) {
    throw findError;
  }

  const profile = await getInstagramProfile(userId);

  // Contact artıq varsa, username/name-i yenilə
  if (existing) {
    const updates = {};

    if (profile.username) {
      updates.username = profile.username;
    }

    if (profile.name && !existing.full_name) {
      updates.full_name = profile.name;
    }

    if (Object.keys(updates).length > 0) {
      const { data: updated, error: updateError } = await supabase
        .from("instagram_contacts")
        .update(updates)
        .eq("id", existing.id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      return updated;
    }

    return existing;
  }

  // Yeni contact
  const { data, error } = await supabase
    .from("instagram_contacts")
    .insert({
      instagram_user_id: userId,
      username: profile.username,
      full_name: profile.name,
      current_step: "dma_started",
      qualification_status: "in_progress"
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}
