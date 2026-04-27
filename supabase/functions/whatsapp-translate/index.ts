// @ts-nocheck
// Translate a WhatsApp message body to English for internal staff.
// Uses Lovable AI Gateway. Result is cached on the message row in payload._translation_en.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { message_id, text } = await req.json();
    if (!message_id && !text) {
      return new Response(JSON.stringify({ ok: false, error: "message_id or text required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body = text as string | undefined;
    let existingPayload: any = {};
    if (message_id) {
      const { data: msg } = await admin
        .from("whatsapp_messages")
        .select("body, payload")
        .eq("id", message_id)
        .maybeSingle();
      if (!msg) {
        return new Response(JSON.stringify({ ok: false, error: "Message not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      body = body || msg.body || "";
      existingPayload = msg.payload || {};
      // Return cached translation if present
      if (existingPayload?._translation_en) {
        return new Response(
          JSON.stringify({ ok: true, translation: existingPayload._translation_en, cached: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!body || !body.trim()) {
      return new Response(JSON.stringify({ ok: false, error: "Empty text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a translator. Translate the user's message to clear, natural English. If the message is already in English, return it unchanged. Output ONLY the translation, no quotes, no explanations, no language labels.",
          },
          { role: "user", content: body },
        ],
        temperature: 0.2,
        max_tokens: 400,
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      if (r.status === 429) throw new Error("Rate limited, try again later");
      if (r.status === 402) throw new Error("AI credits exhausted");
      throw new Error(`AI gateway error ${r.status}: ${t}`);
    }
    const j = await r.json();
    const translation = (j.choices?.[0]?.message?.content || "").trim();

    if (message_id && translation) {
      await admin
        .from("whatsapp_messages")
        .update({ payload: { ...existingPayload, _translation_en: translation } })
        .eq("id", message_id);
    }

    return new Response(JSON.stringify({ ok: true, translation, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
