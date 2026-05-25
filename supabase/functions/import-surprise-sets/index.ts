const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ImportBody = {
  channels?: string[];
  dates?: string[];
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const cleanList = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;

  const cleaned = value
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  return cleaned.length ? cleaned : fallback;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const appsScriptUrl = Deno.env.get("GAS_SURPRISE_IMPORT_URL");
    const token = Deno.env.get("GAS_SURPRISE_IMPORT_TOKEN");

    if (!appsScriptUrl || !token) {
      return jsonResponse(
        { ok: false, error: "Missing Google Apps Script import secrets." },
        500,
      );
    }

    const body = (await req.json().catch(() => ({}))) as ImportBody;

    const channels = cleanList(body.channels, ["CK", "PS", "PM"])
      .map((item) => item.toUpperCase())
      .join(",");

    const dates = cleanList(body.dates, [])
      .map((item) => String(item))
      .join(",");

    const url = new URL(appsScriptUrl);
    url.searchParams.set("token", token);
    url.searchParams.set("channels", channels);
    if (dates) url.searchParams.set("dates", dates);

    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
    });

    const text = await response.text();

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "Apps Script returned non-JSON response.",
          status: response.status,
          preview: text.slice(0, 500),
        },
        502,
      );
    }

    if (!response.ok) {
      return jsonResponse(
        {
          ok: false,
          error: `Apps Script request failed with ${response.status}.`,
          data,
        },
        502,
      );
    }

    if (
      data &&
      typeof data === "object" &&
      "ok" in data &&
      (data as { ok?: boolean }).ok === false
    ) {
      return jsonResponse(
        {
          ok: false,
          error:
            (data as { error?: string }).error ||
            "Apps Script returned ok false.",
          data,
        },
        502,
      );
    }

    return jsonResponse({
      ok: true,
      source: "google-apps-script",
      importedAt: new Date().toISOString(),
      data,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: String(error instanceof Error ? error.message : error),
      },
      500,
    );
  }
});
