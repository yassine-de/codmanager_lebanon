// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const WAKILNI_BASE = Deno.env.get("WAKILNI_API_BASE") || "https://api.wakilni.com/api/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase service configuration");
  return createClient(supabaseUrl, serviceRoleKey);
}

async function getAuthenticatedUser(req: Request, supabase: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) throw new Error("Authentication required");

  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) throw new Error("Authentication required");
  return data.user;
}

async function wakilniRequest(path: string, token: string, body?: Record<string, unknown>) {
  const response = await fetch(`${WAKILNI_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok || payload?.success === false || payload?.status === false) {
    throw new Error(`Tracking request failed: ${response.status}`);
  }

  return payload;
}

async function wakilniGet(path: string, token: string) {
  const response = await fetch(`${WAKILNI_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok || payload?.success === false || payload?.status === false) {
    throw new Error(`Tracking request failed: ${response.status}`);
  }

  return payload;
}

async function getWakilniToken() {
  const key = Deno.env.get("WAKILNI_API_KEY");
  const secret = Deno.env.get("WAKILNI_API_SECRET");
  if (!key || !secret) throw new Error("Tracking is not configured");

  const params = new URLSearchParams({ key, secret });
  const response = await fetch(`${WAKILNI_BASE}/third_party/auth_token?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) throw new Error("Tracking is not available");
  const token = payload.token || payload.data?.token || payload.access_token;
  if (!token) throw new Error("Tracking is not available");
  return String(token);
}

function mapDeliveryStatus(status?: string | null, statusCode?: string | number | null) {
  const normalizedStatus = String(status || "").toLowerCase().trim();
  const normalizedCode = String(statusCode ?? "").toLowerCase().trim();
  const combined = `${normalizedStatus} ${normalizedCode}`.trim();
  const numericCode = /^\d+$/.test(normalizedCode)
    ? normalizedCode
    : /^\d+$/.test(normalizedStatus)
      ? normalizedStatus
      : "";

  if (numericCode === "10" || combined.includes("pending cancellation")) return "cancelled";
  if (numericCode === "7" || combined.includes("cancelled") || combined.includes("canceled")) return "cancelled";
  if (numericCode === "6" || ["declined", "rejected", "refused"].some((s) => combined.includes(s))) return "rejected";
  if (numericCode === "4" || combined.includes("success")) return "delivered";
  if (numericCode === "2" || numericCode === "3" || combined.includes("confirmed") || combined.includes("processing")) return "shipped";
  if (combined.includes("delivered")) return "delivered";
  if (combined.includes("return")) return "returned";
  if (combined.includes("failed")) return "failed_attempt";
  if (combined.includes("out for delivery") || combined.includes("with courier")) return "with_courier";
  if (combined.includes("transit")) return "in_transit";
  if (combined.includes("picked") || combined.includes("pickup") || combined.includes("shipped")) return "shipped";
  if (combined.includes("pending") || combined.includes("created")) return "booked";

  return null;
}

function publicStatusLabel(status: string | null | undefined) {
  const labels: Record<string, string> = {
    pending: "Pending",
    booked: "Booked",
    shipped: "Shipped",
    in_transit: "In transit",
    with_courier: "Out for delivery",
    delivered: "Delivered",
    failed_attempt: "Delivery attempt failed",
    returned: "Returned",
    cancelled: "Cancelled",
    rejected: "Rejected",
  };
  return labels[String(status || "")] || "Pending";
}

function publicEventLabel(status?: string | null, statusCode?: string | number | null) {
  const mapped = mapDeliveryStatus(status, statusCode);
  return publicStatusLabel(mapped || "pending");
}

function buildPublicEvents(order: any, tracking: any, mappedStatus: string) {
  const currentLabel = publicStatusLabel(mappedStatus);
  const currentCreatedAt = mappedStatus === "delivered"
    ? tracking.completed_on || order.delivered_at || order.wakilni_synced_at || order.updated_at || null
    : order.wakilni_synced_at || order.updated_at || null;

  const events = [
    { label: currentLabel, created_at: currentCreatedAt },
    ...(tracking.logs || []).map((event: any) => ({
      label: event.label || "Status update",
      created_at: event.created_at || null,
    })),
  ];

  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.label}|${event.created_at || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchTracking(order: any) {
  const token = await getWakilniToken();
  const result: any = {
    status: null,
    status_code: null,
    completed_on: null,
    logs: [],
  };

  if (order.wakilni_tracking_id) {
    try {
      const statusPayload = await wakilniRequest(`/clients/tracking/orders/${encodeURIComponent(order.wakilni_tracking_id)}`, token);
      result.status = statusPayload.status_code || statusPayload.status || statusPayload.message;
      result.status_code = statusPayload.status;
      result.completed_on = statusPayload.completed_on || null;
    } catch {
      // Details endpoint below is enough for the seller view.
    }
  }

  const query = new URLSearchParams();
  if (order.wakilni_tracking_id) query.set("tracking_id", order.wakilni_tracking_id);
  if (order.wakilni_order_id) query.set("order_id", order.wakilni_order_id);

  if (query.toString()) {
    const details = await wakilniGet(`/clients/orders/status?${query.toString()}`, token);
    const data = details?.data || details?.order || details;
    result.status = data?.status_code || data?.status || result.status;
    result.status_code = data?.status_id || data?.status || result.status_code;
    result.completed_on = data?.completed_on || data?.updated_at || result.completed_on || null;

    const possibleLogs = data?.logs || data?.tracking || data?.history || details?.logs || details?.tracking || [];
    if (Array.isArray(possibleLogs)) {
      result.logs = possibleLogs.map((event: any) => ({
        label: publicEventLabel(event.status || event.name || event.description || event.status_code, event.status_id || event.code),
        created_at: event.created_at || event.date || event.datetime || event.completed_on || null,
      }));
    }
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = getSupabaseAdmin();
    const user = await getAuthenticatedUser(req, supabase);
    const body = await req.json();
    const orderId = String(body.order_id || body.orderId || "").trim();
    if (!orderId) throw new Error("order_id required");

    const { data: order, error } = await supabase
      .from("orders")
      .select("id, order_id, seller_id, delivery_status, delivered_at, updated_at, wakilni_order_id, wakilni_tracking_id, wakilni_synced_at")
      .eq("order_id", orderId)
      .eq("seller_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!order) return jsonResponse({ error: "Tracking not found" }, 404);
    if (!order.wakilni_tracking_id && !order.wakilni_order_id) {
      return jsonResponse({
        order_id: order.order_id,
        status: publicStatusLabel(order.delivery_status),
        delivery_status: order.delivery_status || "pending",
        completed_on: order.delivered_at || null,
        events: [],
      });
    }

    const tracking = await fetchTracking(order);
    const mappedStatus = mapDeliveryStatus(tracking.status, tracking.status_code) || order.delivery_status || "pending";
    const events = buildPublicEvents(order, tracking, mappedStatus);

    return jsonResponse({
      order_id: order.order_id,
      status: publicStatusLabel(mappedStatus),
      delivery_status: mappedStatus,
      completed_on: mappedStatus === "delivered" ? (tracking.completed_on || order.delivered_at || null) : null,
      events,
    });
  } catch (error) {
    const message = String(error?.message || error);
    const status = message.includes("Authentication") ? 401 : 400;
    return jsonResponse({ error: message }, status);
  }
});
