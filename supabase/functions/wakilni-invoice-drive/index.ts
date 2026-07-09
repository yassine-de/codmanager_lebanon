// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

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
  return data.files || [];
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
  return { meta, base64: bytesToBase64(bytes) };
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

    const { admin } = await requireAdmin(req, supabaseUrl, anonKey, serviceRoleKey);
    const folderId = await getFolderId(admin, body.folder_id || body.folderId);
    const accessToken = await getGoogleAccessToken(googleKey);

    if (action === "download") {
      if (!body.file_id && !body.fileId) throw new Error("file_id is required");
      const result = await downloadDriveFile(accessToken, body.file_id || body.fileId);
      return jsonResponse({ success: true, file: result.meta, base64: result.base64 });
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
