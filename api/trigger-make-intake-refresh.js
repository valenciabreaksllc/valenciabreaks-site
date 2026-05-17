export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  const webhookUrl = process.env.MAKE_INTAKE_REFRESH_WEBHOOK_URL;

  if (!webhookUrl) {
    return res.status(500).json({
      ok: false,
      error: "Missing MAKE_INTAKE_REFRESH_WEBHOOK_URL",
    });
  }

  try {
    const makeResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "ops-command-hub",
        action: "manual-intake-refresh",
        triggered_at: new Date().toISOString(),
      }),
    });

    if (!makeResponse.ok) {
      return res.status(502).json({
        ok: false,
        error: `Make returned status ${makeResponse.status}`,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Make intake refresh started",
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: "Failed to reach Make webhook",
    });
  }
}
