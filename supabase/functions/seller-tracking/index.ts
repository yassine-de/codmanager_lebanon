// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

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
    ready_for_return: "Ready for return",
  };
  return labels[String(status || "")] || "Pending";
}

function buildPublicEvents(order: any, history: any[]) {
  const currentStatus = order.delivery_status || "pending";
  const currentLabel = publicStatusLabel(currentStatus);
  const statusEvents = (history || [])
    .filter((entry) => entry.field_changed === "delivery_status" && entry.new_value)
    .map((entry) => ({
      label: publicStatusLabel(entry.new_value),
      created_at: entry.created_at || null,
    }));
  const hasCurrentStatusEvent = statusEvents.some((event) => event.label === currentLabel);

  const events = [
    ...(hasCurrentStatusEvent ? [] : [{
      label: currentLabel,
      created_at: currentStatus === "delivered"
        ? order.delivered_at || order.wakilni_synced_at || order.updated_at || null
        : order.wakilni_synced_at || order.updated_at || null,
    }]),
    ...statusEvents,
    {
      label: "Order created",
      created_at: order.created_at || null,
    },
  ];

  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.label}|${event.created_at || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      .select("id, order_id, seller_id, delivery_status, delivered_at, created_at, updated_at, wakilni_synced_at")
      .eq("order_id", orderId)
      .eq("seller_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!order) return jsonResponse({ error: "Tracking not found" }, 404);

    const { data: history, error: historyError } = await supabase
      .from("order_history")
      .select("field_changed, new_value, created_at")
      .eq("order_id", order.order_id)
      .eq("field_changed", "delivery_status")
      .order("created_at", { ascending: false })
      .limit(50);

    if (historyError) throw historyError;

    const deliveryStatus = order.delivery_status || "pending";

    return jsonResponse({
      order_id: order.order_id,
      status: publicStatusLabel(deliveryStatus),
      delivery_status: deliveryStatus,
      completed_on: deliveryStatus === "delivered" ? order.delivered_at || null : null,
      events: buildPublicEvents(order, history || []),
    });
  } catch (error) {
    const message = String(error?.message || error);
    const status = message.includes("Authentication") ? 401 : 400;
    return jsonResponse({ error: message }, status);
  }
});
