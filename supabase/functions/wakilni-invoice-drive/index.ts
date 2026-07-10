// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";
import { getResolvedPDFJS } from "https://esm.sh/unpdf@0.10.1?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_FOLDER_ID = "1hpDtSIx3pzc7r5gm9LuSS28ALikhTBJr";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64Url(input: string | Uint8Array) {
  const raw = typeof input === "string" ? btoa(input) : bytesToBase64(input);
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

async function getGoogleAccessToken(serviceAccountKey: string): Promise<string> {
  const sa = JSON.parse(serviceAccountKey);
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64Url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const signInput = `${header}.${claimSet}`;
  const pemContent = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signInput),
  );
  const jwt = `${signInput}.${base64Url(new Uint8Array(signatureBuffer))}`;
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenResp.json();
  if (!tokenResp.ok) throw new Error(`Google auth failed: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

async function requireAdmin(req: Request, supabaseUrl: string, anonKey: string, serviceRoleKey: string) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing authorization token");

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData?.user) throw new Error("Invalid authorization token");

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: roleRow, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (roleError) throw roleError;
  if (roleRow?.role !== "admin") throw new Error("Admin access required");

  return { admin, user: userData.user };
}

function normalizeAmount(value: string) {
  return Number(String(value || "0").replace(/,/g, "").replace(/\s/g, ""));
}

function parsePdfDate(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) return null;
  const year = Number(match[3]) + 2000;
  return `${year}-${match[2]}-${match[1]}`;
}

function parseInvoiceLine(line: string) {
  const cleaned = line.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.includes("Order Number") || cleaned.startsWith("QUOTI HOME")) return null;

  const moneyMatches = [...cleaned.matchAll(/USD\s+(-?\d+(?:[.,]\d+)?)/gi)];
  if (moneyMatches.length < 2) return null;

  const firstMoney = moneyMatches[0];
  const secondMoney = moneyMatches[1];
  const prefix = cleaned.slice(0, firstMoney.index).trim();
  const suffix = cleaned.slice((secondMoney.index || 0) + secondMoney[0].length).trim();
  const orderMatch = prefix.match(/^(\d{6,})\s+#\s*([0-9]*)\s*(.*)$/);
  if (!orderMatch) return null;

  const dateMatch = cleaned.match(/(\d{2}\.\d{2}\.\d{2})\s*$/);
  const typeMatch = suffix.match(/\b(Cash|Card|Transfer|Credit)\b/i);
  const area = suffix
    .replace(/\b(Cash|Card|Transfer|Credit)\b/i, "")
    .replace(/(\d{2}\.\d{2}\.\d{2})\s*$/, "")
    .trim() || null;

  return {
    wakilniOrderId: orderMatch[1],
    waybill: orderMatch[2] || null,
    recipientName: orderMatch[3]?.trim() || "",
    deliveryFeeUsd: normalizeAmount(firstMoney[1]),
    collectionUsd: normalizeAmount(secondMoney[1]),
    collectionType: typeMatch?.[1] || null,
    area,
    invoiceDate: parsePdfDate(dateMatch?.[1] || null),
    rawLine: cleaned,
  };
}

function parseInvoiceTotalsFromText(text: string) {
  const read = (currency: "USD" | "LBP", label: string) => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escapedLabel}\\s+${currency}\\s+(-?\\d[\\d,]*(?:\\.\\d+)?)`, "i");
    const match = text.match(pattern);
    return match ? normalizeAmount(match[1]) : 0;
  };

  return {
    total_collection_usd: read("USD", "Total Collection"),
    total_wk_fees_usd: read("USD", "Total WK Fees"),
    grand_total_usd: read("USD", "Grand Total"),
    total_collection_lbp: read("LBP", "Total Collection"),
    total_wk_fees_lbp: read("LBP", "Total WK Fees"),
    grand_total_lbp: read("LBP", "Grand Total"),
  };
}

async function extractRowsFromPdfBytes(bytes: Uint8Array) {
  const { getDocument } = await getResolvedPDFJS();
  const doc = await getDocument({
    data: bytes,
    disableWorker: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;
  const rows = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = (content.items || [])
      .map((item: any) => ({
        str: String(item.str || "").trim(),
        x: item.transform?.[4] || 0,
        y: item.transform?.[5] || 0,
      }))
      .filter((item: any) => item.str.length > 0);

    const lineMap = new Map();
    for (const item of items) {
      const key = Math.round(item.y / 3) * 3;
      const existing = lineMap.get(key) || [];
      existing.push(item);
      lineMap.set(key, existing);
    }

    const lines = [...lineMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, lineItems]) => lineItems.sort((a, b) => a.x - b.x).map((item) => item.str).join(" "));

    for (const line of lines) {
      const parsed = parseInvoiceLine(line);
      if (parsed) rows.push(parsed);
    }
  }

  return rows;
}

async function extractInvoiceDataFromPdfBytes(bytes: Uint8Array) {
  const { getDocument } = await getResolvedPDFJS();
  const doc = await getDocument({
    data: bytes,
    disableWorker: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;
  const rows = [];
  const allLines = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = (content.items || [])
      .map((item: any) => ({
        str: String(item.str || "").trim(),
        x: item.transform?.[4] || 0,
        y: item.transform?.[5] || 0,
      }))
      .filter((item: any) => item.str.length > 0);

    const lineMap = new Map();
    for (const item of items) {
      const key = Math.round(item.y / 3) * 3;
      const existing = lineMap.get(key) || [];
      existing.push(item);
      lineMap.set(key, existing);
    }

    const lines = [...lineMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, lineItems]) => lineItems.sort((a, b) => a.x - b.x).map((item) => item.str).join(" "));

    allLines.push(...lines);
    for (const line of lines) {
      const parsed = parseInvoiceLine(line);
      if (parsed) rows.push(parsed);
    }
  }

  return { rows, totals: parseInvoiceTotalsFromText(allLines.join("\n")) };
}

function getInvoiceFileDate(file: any) {
  const match = String(file?.name || "").match(/(\d{4}-\d{2}-\d{2})/);
  const byName = match ? Date.parse(`${match[1]}T00:00:00Z`) : Number.NaN;
  if (Number.isFinite(byName)) return byName;
  return Date.parse(file?.modifiedTime || "") || 0;
}

function sortInvoiceFiles(files: any[]) {
  return [...files].sort((a, b) => getInvoiceFileDate(b) - getInvoiceFileDate(a));
}

async function getFolderId(admin: ReturnType<typeof createClient>, requestedFolderId?: string | null) {
  if (requestedFolderId) return requestedFolderId;
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "wakilni_invoice_drive_folder_id")
    .maybeSingle();
  return data?.value || DEFAULT_FOLDER_ID;
}

async function listDriveFiles(accessToken: string, folderId: string) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and mimeType = 'application/pdf'`,
    fields: "files(id,name,mimeType,modifiedTime,size,webViewLink)",
    orderBy: "modifiedTime desc",
    pageSize: "100",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Drive list failed: ${JSON.stringify(data)}`);
  return sortInvoiceFiles(data.files || []);
}

async function downloadDriveFile(accessToken: string, fileId: string) {
  const metaResp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,size,webViewLink&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const meta = await metaResp.json();
  if (!metaResp.ok) throw new Error(`Drive metadata failed: ${JSON.stringify(meta)}`);
  if (meta.mimeType !== "application/pdf") throw new Error("Selected Drive file is not a PDF");

  const fileResp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!fileResp.ok) throw new Error(`Drive download failed [${fileResp.status}]: ${await fileResp.text()}`);
  const bytes = new Uint8Array(await fileResp.arrayBuffer());
  return { meta, bytes, base64: bytesToBase64(bytes) };
}

async function findLatestUnimportedPdf(admin: ReturnType<typeof createClient>, accessToken: string, folderId: string) {
  const files = await listDriveFiles(accessToken, folderId);
  const ids = files.map((file: any) => file.id).filter(Boolean);
  if (ids.length === 0) return { file: null, files };

  const { data: imports } = await admin
    .from("wakilni_invoice_imports")
    .select("google_drive_file_id")
    .in("google_drive_file_id", ids);
  const importedIds = new Set((imports || []).map((item: any) => item.google_drive_file_id));
  const candidates = files.filter((file: any) => !importedIds.has(file.id));
  return { file: candidates[0] || null, files };
}

async function matchRows(admin: ReturnType<typeof createClient>, rows: any[]) {
  const wakilniIds = [...new Set(rows.map((r) => r.wakilniOrderId).filter(Boolean))];
  const waybills = [...new Set(rows.map((r) => r.waybill).filter(Boolean))];
  const ordersByWakilni = new Map();
  const ordersByWaybill = new Map();

  for (let i = 0; i < wakilniIds.length; i += 200) {
    const { data, error } = await admin
      .from("orders")
      .select("id, order_id, system_id, customer_name, product_name, quantity, price, total_amount, delivery_status, wakilni_paid_at, wakilni_order_id")
      .in("wakilni_order_id", wakilniIds.slice(i, i + 200));
    if (error) throw error;
    (data || []).forEach((order: any) => order.wakilni_order_id && ordersByWakilni.set(String(order.wakilni_order_id), order));
  }

  for (let i = 0; i < waybills.length; i += 200) {
    const { data, error } = await admin
      .from("orders")
      .select("id, order_id, system_id, customer_name, product_name, quantity, price, total_amount, delivery_status, wakilni_paid_at, wakilni_order_id")
      .in("order_id", waybills.slice(i, i + 200));
    if (error) throw error;
    (data || []).forEach((order: any) => ordersByWaybill.set(String(order.order_id), order));
  }

  return rows.map((row) => {
    const order = ordersByWakilni.get(row.wakilniOrderId) || (row.waybill ? ordersByWaybill.get(row.waybill) : undefined);
    if (!order) return { ...row, matchStatus: "unmatched", mismatchReason: "No matching order found" };
    if (Number(row.collectionUsd || 0) <= 0 && order.delivery_status === "delivered") {
      return { ...row, order, matchStatus: "rejected_zero_collection", mismatchReason: "Wakilni collection is 0.00, order should be rejected instead of delivered" };
    }
    if (order.delivery_status !== "delivered") {
      return { ...row, order, matchStatus: "not_delivered", mismatchReason: `Order status is ${order.delivery_status || "empty"}` };
    }
    if (order.wakilni_paid_at) return { ...row, order, matchStatus: "already_paid", mismatchReason: null };
    const expected = Number(order.total_amount || 0);
    if (Math.abs(expected - row.collectionUsd) > 0.05) {
      return { ...row, order, matchStatus: "amount_adjusted", mismatchReason: `System amount adjusted from ${expected.toFixed(2)} USD to Wakilni ${row.collectionUsd.toFixed(2)} USD` };
    }
    return { ...row, order, matchStatus: "newly_paid", mismatchReason: null };
  });
}

function invoiceNumberFromFileName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "");
}

async function applyMatchedInvoice(admin: ReturnType<typeof createClient>, matchedRows: any[], file: any, userId: string | null = null, totals: any = {}) {
  const existing = await admin
    .from("wakilni_invoice_imports")
    .select("id, imported_at")
    .eq("google_drive_file_id", file.id)
    .maybeSingle();
  if (existing.data) {
    return { skipped: true, reason: "Drive file already imported", import_id: existing.data.id };
  }

  const rowsToPay = matchedRows.filter((row) => ["newly_paid", "amount_adjusted"].includes(row.matchStatus) && row.order);
  const rowsToReject = matchedRows.filter((row) => row.matchStatus === "rejected_zero_collection" && row.order);
  const warningStatuses = ["amount_adjusted", "rejected_zero_collection", "amount_mismatch", "not_delivered"];
  const insertImport = {
    invoice_number: invoiceNumberFromFileName(file.name),
    file_name: file.name,
    google_drive_file_id: file.id,
    google_drive_file_name: file.name,
    google_drive_web_view_link: file.webViewLink || null,
    imported_by: userId,
    row_count: matchedRows.length,
    matched_count: matchedRows.filter((row) => !!row.order).length,
    newly_paid_count: rowsToPay.length,
    already_paid_count: matchedRows.filter((row) => row.matchStatus === "already_paid").length,
    unmatched_count: matchedRows.filter((row) => row.matchStatus === "unmatched").length,
    warnings_count: matchedRows.filter((row) => warningStatuses.includes(row.matchStatus)).length,
    amount_total_usd: matchedRows.reduce((sum, row) => sum + Number(row.collectionUsd || 0), 0),
    delivery_fee_total_usd: matchedRows.reduce((sum, row) => sum + Number(row.deliveryFeeUsd || 0), 0),
    total_collection_usd: Number(totals.total_collection_usd || matchedRows.reduce((sum, row) => sum + Number(row.collectionUsd || 0), 0)),
    total_wk_fees_usd: Number(totals.total_wk_fees_usd || matchedRows.reduce((sum, row) => sum + Number(row.deliveryFeeUsd || 0), 0)),
    grand_total_usd: Number(totals.grand_total_usd || 0),
    total_collection_lbp: Number(totals.total_collection_lbp || 0),
    total_wk_fees_lbp: Number(totals.total_wk_fees_lbp || 0),
    grand_total_lbp: Number(totals.grand_total_lbp || 0),
    processing_status: "processed",
    processing_summary: {
      row_count: matchedRows.length,
      matched_count: matchedRows.filter((row) => !!row.order).length,
      newly_paid_count: rowsToPay.length,
      already_paid_count: matchedRows.filter((row) => row.matchStatus === "already_paid").length,
      unmatched_count: matchedRows.filter((row) => row.matchStatus === "unmatched").length,
      warnings_count: matchedRows.filter((row) => warningStatuses.includes(row.matchStatus)).length,
    },
  };

  const { data: importRow, error: importError } = await admin
    .from("wakilni_invoice_imports")
    .insert(insertImport)
    .select("id")
    .single();
  if (importError) {
    if (String(importError.message || "").includes("duplicate")) {
      return { skipped: true, reason: "Drive file already imported" };
    }
    throw importError;
  }

  const importId = importRow.id;
  const rowPayload = matchedRows.map((row) => ({
    import_id: importId,
    wakilni_order_id: row.wakilniOrderId,
    waybill: row.waybill,
    recipient_name: row.recipientName,
    delivery_fee_usd: row.deliveryFeeUsd,
    collection_usd: row.collectionUsd,
    collection_type: row.collectionType,
    area: row.area,
    invoice_date: row.invoiceDate,
    matched_order_id: row.order?.id || null,
    match_status: row.matchStatus,
    mismatch_reason: row.mismatchReason,
  }));

  for (let i = 0; i < rowPayload.length; i += 500) {
    const { error } = await admin.from("wakilni_invoice_rows").insert(rowPayload.slice(i, i + 500));
    if (error) throw error;
  }

  const now = new Date().toISOString();
  for (let i = 0; i < rowsToReject.length; i += 100) {
    const batch = rowsToReject.slice(i, i + 100);
    await Promise.all(batch.map(async (row) => {
      const { error } = await admin
        .from("orders")
        .update({
          delivery_status: "rejected",
          updated_at: now,
          wakilni_invoice_import_id: importId,
          wakilni_invoice_number: invoiceNumberFromFileName(file.name),
          wakilni_invoice_collection_usd: row.collectionUsd,
          wakilni_invoice_delivery_fee_usd: row.deliveryFeeUsd,
          wakilni_invoice_matched_at: now,
        })
        .eq("id", row.order.id)
        .eq("delivery_status", "delivered");
      if (error) throw error;

      const { error: historyError } = await admin.from("order_history").insert({
        order_id: row.order.order_id,
        changed_by: userId,
        changed_by_role: userId ? "admin" : "system",
        field_changed: "delivery_status",
        old_value: row.order.delivery_status,
        new_value: "rejected",
        action_type: "wakilni_invoice_zero_collection",
      });
      if (historyError) console.error("order_history insert failed:", historyError);
    }));
  }

  for (let i = 0; i < rowsToPay.length; i += 100) {
    const batch = rowsToPay.slice(i, i + 100);
    await Promise.all(batch.map(async (row) => {
      const quantity = Math.max(1, Number(row.order.quantity || 1));
      const expected = Number(row.order.total_amount || 0);
      const adjusted = row.matchStatus === "amount_adjusted";
      const nextTotal = Number(row.collectionUsd || 0);
      const nextPrice = Number((nextTotal / quantity).toFixed(2));
      const updatePayload: Record<string, unknown> = {
        wakilni_paid_at: now,
        wakilni_paid_by: userId,
        wakilni_invoice_import_id: importId,
        wakilni_invoice_number: invoiceNumberFromFileName(file.name),
        wakilni_invoice_collection_usd: row.collectionUsd,
        wakilni_invoice_delivery_fee_usd: row.deliveryFeeUsd,
        wakilni_invoice_matched_at: now,
      };
      if (adjusted) {
        updatePayload.total_amount = nextTotal;
        updatePayload.price = nextPrice;
        updatePayload.updated_at = now;
      }

      const { error } = await admin
        .from("orders")
        .update(updatePayload)
        .eq("id", row.order.id)
        .is("wakilni_paid_at", null);
      if (error) throw error;

      if (adjusted) {
        const { error: historyError } = await admin.from("order_history").insert([
          {
            order_id: row.order.order_id,
            changed_by: userId,
            changed_by_role: userId ? "admin" : "system",
            field_changed: "total_amount",
            old_value: expected.toFixed(2),
            new_value: nextTotal.toFixed(2),
            action_type: "wakilni_invoice_amount_adjustment",
          },
          {
            order_id: row.order.order_id,
            changed_by: userId,
            changed_by_role: userId ? "admin" : "system",
            field_changed: "price",
            old_value: Number(row.order.price || 0).toFixed(2),
            new_value: nextPrice.toFixed(2),
            action_type: "wakilni_invoice_amount_adjustment",
          },
        ]);
        if (historyError) console.error("order_history insert failed:", historyError);
      }
    }));
  }

  return {
    skipped: false,
    import_id: importId,
    row_count: matchedRows.length,
    newly_paid_count: rowsToPay.length,
    already_paid_count: matchedRows.filter((row) => row.matchStatus === "already_paid").length,
    unmatched_count: matchedRows.filter((row) => row.matchStatus === "unmatched").length,
    warnings_count: matchedRows.filter((row) => warningStatuses.includes(row.matchStatus)).length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "list";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const googleKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
    if (!googleKey) return jsonResponse({ error: "GOOGLE_SERVICE_ACCOUNT_KEY not configured" }, 500);

    const cronRun = action === "process-latest" && body.source === "cron";
    const authContext = cronRun
      ? { admin: createClient(supabaseUrl, serviceRoleKey), user: null }
      : await requireAdmin(req, supabaseUrl, anonKey, serviceRoleKey);
    const { admin, user } = authContext;
    const folderId = await getFolderId(admin, body.folder_id || body.folderId);
    const accessToken = await getGoogleAccessToken(googleKey);

    if (action === "download") {
      if (!body.file_id && !body.fileId) throw new Error("file_id is required");
      const result = await downloadDriveFile(accessToken, body.file_id || body.fileId);
      return jsonResponse({ success: true, file: result.meta, base64: result.base64 });
    }

    if (action === "process-latest") {
      const { file } = await findLatestUnimportedPdf(admin, accessToken, folderId);
      await admin
        .from("app_settings")
        .upsert(
          { key: "wakilni_invoice_auto_last_run_at", value: new Date().toISOString(), updated_at: new Date().toISOString() },
          { onConflict: "key" },
        );

      if (!file) {
        return jsonResponse({
          success: true,
          skipped: true,
          reason: "No new Wakilni invoice PDF found",
          folder_id: folderId,
        });
      }

      const result = await downloadDriveFile(accessToken, file.id);
      const { rows, totals } = await extractInvoiceDataFromPdfBytes(result.bytes);
      const matchedRows = await matchRows(admin, rows);
      if (body.dry_run === true || body.dryRun === true) {
        return jsonResponse({
          success: true,
          dry_run: true,
          folder_id: folderId,
          file: result.meta,
          parsed_rows: rows.length,
          matched_count: matchedRows.filter((row) => !!row.order).length,
          newly_paid_count: matchedRows.filter((row) => row.matchStatus === "newly_paid").length,
          already_paid_count: matchedRows.filter((row) => row.matchStatus === "already_paid").length,
          unmatched_count: matchedRows.filter((row) => row.matchStatus === "unmatched").length,
          warnings_count: matchedRows.filter((row) => ["amount_adjusted", "rejected_zero_collection", "amount_mismatch", "not_delivered"].includes(row.matchStatus)).length,
          totals,
        });
      }
      const applied = await applyMatchedInvoice(admin, matchedRows, result.meta, user?.id || null, totals);

      await admin
        .from("app_settings")
        .upsert(
          { key: "wakilni_invoice_auto_last_processed_file", value: result.meta.name, updated_at: new Date().toISOString() },
          { onConflict: "key" },
        );

      return jsonResponse({
        success: true,
        folder_id: folderId,
        file: result.meta,
        parsed_rows: rows.length,
        ...applied,
      });
    }

    const files = await listDriveFiles(accessToken, folderId);
    const ids = files.map((file: any) => file.id).filter(Boolean);
    let importedById = new Map<string, any>();
    if (ids.length > 0) {
      const { data: imports } = await admin
        .from("wakilni_invoice_imports")
        .select("id, google_drive_file_id, imported_at, newly_paid_count, already_paid_count, unmatched_count")
        .in("google_drive_file_id", ids);
      importedById = new Map((imports || []).map((item: any) => [item.google_drive_file_id, item]));
    }

    return jsonResponse({
      success: true,
      folder_id: folderId,
      files: files.map((file: any) => ({
        ...file,
        imported: importedById.has(file.id),
        import: importedById.get(file.id) || null,
      })),
    });
  } catch (error) {
    console.error("wakilni-invoice-drive error", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
