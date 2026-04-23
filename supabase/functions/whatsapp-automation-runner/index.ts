// WhatsApp Automation Runner
// Executes whatsapp_automations flows (nodes + edges).
//
// Modes:
//  - { trigger_type, order_id }                           → start new run(s)
//  - { resume: true, run_id, button_index? | reply_text? } → continue paused run
//  - { tick: true }                                       → wake delayed runs (cron)
//
// Node types supported: send_template, send_message, ai_step, condition, delay, add_tag, remove_tag.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const log = (...a: unknown[]) => console.log("[wa-runner]", ...a);
const errLog = (...a: unknown[]) => console.error("[wa-runner]", ...a);

interface FlowNode {
  id: string;
  type: string;
  data: Record<string, any>;
}
interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

function normalizePhone(phone: string, defaultCC: string) {
  let p = (phone || "").replace(/\D/g, "");
  if (!p) return "";
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("0")) p = defaultCC + p.slice(1);
  return p;
}

function render(template: string, vars: Record<string, any>) {
  return (template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}

async function getSettings() {
  const { data } = await admin
    .from("whatsapp_settings")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  return data;
}

function findNextNode(edges: FlowEdge[], fromId: string, handle?: string) {
  return edges.find(
    (e) =>
      e.source === fromId &&
      (handle === undefined ? !e.sourceHandle : e.sourceHandle === handle),
  );
}

async function appendLog(runId: string, entry: any) {
  const { data } = await admin
    .from("whatsapp_automation_runs")
    .select("steps_log")
    .eq("id", runId)
    .maybeSingle();
  const log = Array.isArray(data?.steps_log) ? data!.steps_log : [];
  log.push({ at: new Date().toISOString(), ...entry });
  await admin
    .from("whatsapp_automation_runs")
    .update({ steps_log: log })
    .eq("id", runId);
}

// Send WhatsApp template via Meta Cloud API directly (admin context, no auth header).
async function sendTemplate(args: {
  templateId: string;
  to: string;
  vars: Record<string, any>;
  conversationId: string | null;
  orderId: string | null;
  runId: string;
}) {
  const { templateId, to, vars, conversationId, orderId, runId } = args;
  const settings = await getSettings();
  if (!settings) throw new Error("WhatsApp settings missing");
  if (!settings.integration_enabled || !settings.sending_enabled)
    throw new Error("Sending disabled");

  const accessToken = (settings as any).access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
  if (!accessToken) throw new Error("Access token missing");

  const { data: tpl } = await admin
    .from("whatsapp_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (!tpl) throw new Error("Template not found");

  const templateName = tpl.meta_template_name || tpl.name;
  const language = tpl.language || "en_US";

  const components: any[] = [];

  if (tpl.header_type && tpl.header_media_url) {
    const t = String(tpl.header_type).toLowerCase();
    if (t === "image" || t === "video" || t === "document") {
      components.push({
        type: "header",
        parameters: [{ type: t, [t]: { link: tpl.header_media_url } }],
      });
    }
  }

  const payload: any = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length ? { components } : {}),
    },
  };

  const url = `${settings.api_base_url}/${settings.phone_number_id}/messages`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const respJson = await resp.json();
  const ok = resp.ok;
  const metaMsgId = ok ? respJson?.messages?.[0]?.id : null;

  const previewBody = render(tpl.body || `[template: ${templateName}]`, vars);

  if (conversationId) {
    await admin.from("whatsapp_messages").insert({
      conversation_id: conversationId,
      order_id: orderId,
      direction: "out",
      message_type: "template",
      body: previewBody,
      payload: { ...payload, _template_id: templateId, _automation_run_id: runId },
      meta_message_id: metaMsgId,
      status: ok ? "sent" : "failed",
      error_message: ok ? null : JSON.stringify(respJson).slice(0, 500),
    });
    if (ok) {
      const nowIso = new Date().toISOString();
      await admin
        .from("whatsapp_conversations")
        .update({
          last_message_at: nowIso,
          updated_at: nowIso,
          status: "awaiting_reply",
        })
        .eq("id", conversationId);
    }
  }
  if (!ok) throw new Error(`Meta send failed: ${JSON.stringify(respJson).slice(0, 300)}`);
  return { metaMsgId };
}

async function sendText(args: {
  body: string;
  to: string;
  conversationId: string | null;
  orderId: string | null;
  runId: string;
}) {
  const { body, to, conversationId, orderId, runId } = args;
  const settings = await getSettings();
  if (!settings) throw new Error("WhatsApp settings missing");
  const accessToken = (settings as any).access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
  if (!accessToken) throw new Error("Access token missing");

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body },
  };
  const url = `${settings.api_base_url}/${settings.phone_number_id}/messages`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const respJson = await resp.json();
  const ok = resp.ok;
  const metaMsgId = ok ? respJson?.messages?.[0]?.id : null;

  if (conversationId) {
    await admin.from("whatsapp_messages").insert({
      conversation_id: conversationId,
      order_id: orderId,
      direction: "out",
      message_type: "text",
      body,
      payload: { ...payload, _automation_run_id: runId },
      meta_message_id: metaMsgId,
      status: ok ? "sent" : "failed",
      error_message: ok ? null : JSON.stringify(respJson).slice(0, 500),
    });
  }
  if (!ok) throw new Error(`Meta send failed: ${JSON.stringify(respJson).slice(0, 300)}`);
}

async function ensureConversation(order: any, normalizedPhone: string) {
  if (!order) return null;
  const { data: existing } = await admin
    .from("whatsapp_conversations")
    .select("*")
    .eq("order_id", order.order_id)
    .maybeSingle();
  if (existing) return existing;
  const { data: ins, error } = await admin
    .from("whatsapp_conversations")
    .insert({
      order_id: order.order_id,
      customer_phone: normalizedPhone,
      customer_name: order.customer_name ?? null,
      status: "pending",
    })
    .select()
    .single();
  if (error) {
    errLog("conversation insert failed", error);
    return null;
  }
  return ins;
}

function evaluateCondition(node: FlowNode, ctx: { order: any }) {
  const { field, op, value } = node.data ?? {};
  const fv = field ? (ctx.order?.[field] ?? null) : null;
  const v = value ?? "";
  const fvStr = fv == null ? "" : String(fv);
  switch (op) {
    case "eq":
    case "equals":
      return fvStr === String(v);
    case "neq":
      return fvStr !== String(v);
    case "contains":
      return fvStr.toLowerCase().includes(String(v).toLowerCase());
    case "in":
      return String(v).split(",").map((s) => s.trim()).includes(fvStr);
    default:
      return Boolean(fv);
  }
}

async function executeFlow(args: {
  runId: string;
  automation: any;
  order: any | null;
  conversation: any | null;
  startNodeId: string;
}) {
  const { runId, automation, order, conversation, startNodeId } = args;
  const nodes: FlowNode[] = (automation.nodes as any) ?? [];
  const edges: FlowEdge[] = (automation.edges as any) ?? [];

  const settings = await getSettings();
  const defaultCC = settings?.default_country_code || "92";
  const normalizedPhone = normalizePhone(order?.customer_phone || conversation?.customer_phone || "", defaultCC);

  const vars = {
    customer_name: order?.customer_name ?? "",
    product_name: order?.product_name ?? "",
    price: order?.total_amount ?? "",
    city: order?.customer_city ?? "",
    address: order?.customer_address ?? "",
    order_id: order?.order_id ?? "",
    quantity: order?.quantity ?? "",
  };

  let currentId: string | null = startNodeId;
  let safety = 0;
  while (currentId && safety++ < 50) {
    const node = nodes.find((n) => n.id === currentId);
    if (!node) {
      await appendLog(runId, { type: "error", message: `node not found: ${currentId}` });
      break;
    }

    try {
      if (node.type === "send_template") {
        const tplId = node.data?.template_id;
        if (!tplId) throw new Error("send_template missing template_id");
        if (!normalizedPhone) throw new Error("Customer phone invalid");
        await sendTemplate({
          templateId: tplId,
          to: normalizedPhone,
          vars,
          conversationId: conversation?.id ?? null,
          orderId: order?.order_id ?? null,
          runId,
        });
        await appendLog(runId, { type: "send_template", node_id: node.id, template_id: tplId });

        const buttons = Array.isArray(node.data?.template_buttons) ? node.data.template_buttons : [];
        if (buttons.length > 0) {
          await admin
            .from("whatsapp_automation_runs")
            .update({
              status: "waiting_reply",
              current_node_id: node.id,
            })
            .eq("id", runId);
          return;
        }
        currentId = findNextNode(edges, node.id)?.target ?? null;
      } else if (node.type === "send_message") {
        const text = render(String(node.data?.message ?? ""), vars);
        if (!text.trim()) throw new Error("send_message empty");
        if (!normalizedPhone) throw new Error("Customer phone invalid");
        await sendText({
          body: text,
          to: normalizedPhone,
          conversationId: conversation?.id ?? null,
          orderId: order?.order_id ?? null,
          runId,
        });
        await appendLog(runId, { type: "send_message", node_id: node.id });
        currentId = findNextNode(edges, node.id)?.target ?? null;
      } else if (node.type === "ai_step") {
        await appendLog(runId, { type: "ai_step", node_id: node.id, prompt_len: (node.data?.prompt ?? "").length });
        await admin
          .from("whatsapp_automation_runs")
          .update({ status: "waiting_reply", current_node_id: node.id })
          .eq("id", runId);
        return;
      } else if (node.type === "delay") {
        const minutes = Number(node.data?.minutes ?? 0);
        if (minutes > 0) {
          const waitUntil = new Date(Date.now() + minutes * 60_000).toISOString();
          await admin
            .from("whatsapp_automation_runs")
            .update({
              status: "waiting_delay",
              current_node_id: node.id,
              wait_until: waitUntil,
            })
            .eq("id", runId);
          await appendLog(runId, { type: "delay", node_id: node.id, until: waitUntil });
          return;
        }
        currentId = findNextNode(edges, node.id)?.target ?? null;
      } else if (node.type === "condition") {
        const branch = evaluateCondition(node, { order }) ? "true" : "false";
        await appendLog(runId, { type: "condition", node_id: node.id, branch });
        currentId = findNextNode(edges, node.id, branch)?.target ?? null;
      } else if (node.type === "add_tag" || node.type === "remove_tag") {
        await appendLog(runId, { type: node.type, node_id: node.id });
        currentId = findNextNode(edges, node.id)?.target ?? null;
      } else {
        await appendLog(runId, { type: "skip_unknown", node_type: node.type, node_id: node.id });
        currentId = findNextNode(edges, node.id)?.target ?? null;
      }
    } catch (e) {
      const msg = (e as Error).message;
      errLog("node failed", node.id, msg);
      await appendLog(runId, { type: "error", node_id: node.id, message: msg });
      await admin
        .from("whatsapp_automation_runs")
        .update({
          status: "failed",
          error_message: msg,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
      await admin.rpc("noop").catch(() => {});
      return;
    }
  }

  await admin
    .from("whatsapp_automation_runs")
    .update({
      status: "completed",
      current_node_id: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  const { data: autoRow } = await admin
    .from("whatsapp_automations")
    .select("success_count")
    .eq("id", automation.id)
    .maybeSingle();
  await admin
    .from("whatsapp_automations")
    .update({
      success_count: (autoRow?.success_count ?? 0) + 1,
      last_run_at: new Date().toISOString(),
    })
    .eq("id", automation.id);
}

async function startNewRuns(triggerType: string, orderId: string) {
  const { data: order } = await admin
    .from("orders")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (!order) {
    log("order not found", orderId);
    return { started: 0 };
  }

  // Check if order requires WhatsApp validation
  if (triggerType === "new_order" && order.whatsapp_validated !== true) {
    log("order not validated via whatsapp yet, skipping automation", orderId);
    return { started: 0 };
  }

  const { data: autos } = await admin
    .from("whatsapp_automations")
    .select("*")
    .eq("trigger_type", triggerType)
    .eq("status", "active");
  if (!autos?.length) {
    log("no active automations for", triggerType);
    return { started: 0 };
  }

  const settings = await getSettings();
  const defaultCC = settings?.default_country_code || "92";
  const normalizedPhone = normalizePhone(order.customer_phone || "", defaultCC);
  const conv = await ensureConversation(order, normalizedPhone);

  let started = 0;
  for (const a of autos) {
    const nodes: FlowNode[] = (a.nodes as any) ?? [];
    if (!nodes.length) continue;
    const edges: FlowEdge[] = (a.edges as any) ?? [];
    const targetIds = new Set(edges.map((e) => e.target));
    const entry = nodes.find((n) => !targetIds.has(n.id)) ?? nodes[0];

    const { data: run, error } = await admin
      .from("whatsapp_automation_runs")
      .insert({
        automation_id: a.id,
        order_id: order.order_id,
        customer_phone: normalizedPhone,
        conversation_id: conv?.id ?? null,
        status: "running",
        current_node_id: entry.id,
        trigger_payload: { trigger_type: triggerType, order_id: orderId },
        steps_log: [],
      })
      .select()
      .single();
    if (error) {
      errLog("run insert failed", error);
      continue;
    }

    await admin
      .from("whatsapp_automations")
      .update({
        runs_count: (a.runs_count ?? 0) + 1,
        last_run_at: new Date().toISOString(),
      })
      .eq("id", a.id);

    await executeFlow({
      runId: run.id,
      automation: a,
      order,
      conversation: conv,
      startNodeId: entry.id,
    });
    started++;
  }
  return { started };
}

async function resumeRun(runId: string, opts: { buttonIndex?: number; replyText?: string }) {
  const { data: run } = await admin
    .from("whatsapp_automation_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return { ok: false, error: "run not found" };
  if (!["waiting_reply", "waiting_delay", "running"].includes(run.status))
    return { ok: false, error: `run status ${run.status}` };

  const { data: automation } = await admin
    .from("whatsapp_automations")
    .select("*")
    .eq("id", run.automation_id)
    .maybeSingle();
  if (!automation) return { ok: false, error: "automation not found" };

  const { data: order } = run.order_id
    ? await admin.from("orders").select("*").eq("order_id", run.order_id).maybeSingle()
    : { data: null };
  const { data: conv } = run.conversation_id
    ? await admin
        .from("whatsapp_conversations")
        .select("*")
        .eq("id", run.conversation_id)
        .maybeSingle()
    : { data: null };

  const edges: FlowEdge[] = (automation.edges as any) ?? [];
  let handle: string | undefined;
  if (typeof opts.buttonIndex === "number") handle = `btn:${opts.buttonIndex}`;
  const next = run.current_node_id
    ? findNextNode(edges, run.current_node_id, handle) ??
      findNextNode(edges, run.current_node_id)
    : null;

  if (!next) {
    await admin
      .from("whatsapp_automation_runs")
      .update({
        status: "completed",
        current_node_id: null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return { ok: true, completed: true };
  }

  await admin
    .from("whatsapp_automation_runs")
    .update({ status: "running", current_node_id: next.target, wait_until: null })
    .eq("id", runId);

  await executeFlow({
    runId,
    automation,
    order,
    conversation: conv,
    startNodeId: next.target,
  });
  return { ok: true };
}

async function tickDelays() {
  const { data: due } = await admin
    .from("whatsapp_automation_runs")
    .select("id")
    .eq("status", "waiting_delay")
    .lte("wait_until", new Date().toISOString())
    .limit(50);
  if (!due?.length) return { processed: 0 };
  for (const r of due) {
    await resumeRun(r.id, {});
  }
  return { processed: due.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as any;
    log("invoke", { keys: Object.keys(body || {}) });

    if (body.tick) {
      const r = await tickDelays();
      return new Response(JSON.stringify({ ok: true, ...r }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.resume && body.run_id) {
      const r = await resumeRun(body.run_id, {
        buttonIndex: typeof body.button_index === "number" ? body.button_index : undefined,
        replyText: body.reply_text,
      });
      return new Response(JSON.stringify(r), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.trigger_type && body.order_id) {
      const r = await startNewRuns(String(body.trigger_type), String(body.order_id));
      return new Response(JSON.stringify({ ok: true, ...r }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "invalid payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    errLog("fatal", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
