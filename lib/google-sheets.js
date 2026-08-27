export async function syncRegistrationToGoogleSheets(registration) {
  const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;

  if (!url) {
    console.error("GOOGLE_SHEETS_WEBAPP_URL is missing");
    return {
      success: false,
      error: "missing_webapp_url"
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "upsert_registration",
        registration
      })
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.error(
        "Google Sheets returned non-JSON:",
        text
      );

      return {
        success: false,
        error: "invalid_google_response"
      };
    }

    if (!response.ok || !data.success) {
      console.error(
        "Google Sheets sync failed:",
        data
      );

      return {
        success: false,
        error: data.error || "sync_failed"
      };
    }

    return {
      success: true,
      row: data.row || null
    };

  } catch (error) {
    console.error(
      "Google Sheets request failed:",
      error
    );

    return {
      success: false,
      error: String(error)
    };
  }
}
