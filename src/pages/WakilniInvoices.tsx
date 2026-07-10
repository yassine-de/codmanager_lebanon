import { useMemo, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Cloud, DownloadCloud, FileCheck2, FileUp, RefreshCw, Search, WalletCards, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type ParsedInvoiceRow = {
  wakilniOrderId: string;
  waybill: string | null;
  recipientName: string;
  deliveryFeeUsd: number;
  collectionUsd: number;
  collectionType: string | null;
  area: string | null;
  invoiceDate: string | null;
  rawLine: string;
};

type MatchedInvoiceRow = ParsedInvoiceRow & {
  order?: {
    id: string;
    order_id: string;
    system_id: number | null;
    customer_name: string;
    product_name: string;
    quantity: number;
    price: number;
    total_amount: number;
    delivery_status: string | null;
    wakilni_paid_at: string | null;
    wakilni_order_id: string | null;
  };
  matchStatus: "newly_paid" | "already_paid" | "not_delivered" | "amount_mismatch" | "amount_adjusted" | "rejected_zero_collection" | "yellow_store_purchase" | "unmatched";
  mismatchReason: string | null;
};

type ImportHistoryRow = {
  id: string;
  invoice_number: string | null;
  file_name: string;
  google_drive_file_id?: string | null;
  google_drive_file_name?: string | null;
  google_drive_web_view_link?: string | null;
  imported_at: string;
  row_count: number;
  matched_count: number;
  newly_paid_count: number;
  already_paid_count: number;
  unmatched_count: number;
  amount_total_usd: number;
  delivery_fee_total_usd: number;
  total_collection_usd?: number;
  total_wk_fees_usd?: number;
  grand_total_usd?: number;
  total_collection_lbp?: number;
  total_wk_fees_lbp?: number;
  grand_total_lbp?: number;
  warnings_count?: number;
};

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
  imported?: boolean;
  import?: {
    id: string;
    imported_at: string;
    newly_paid_count: number;
    already_paid_count: number;
    unmatched_count: number;
  } | null;
};

const money = (value: number) =>
  `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

const normalizeAmount = (value: string) => Number(value.replace(",", "."));
const normalizeCurrencyAmount = (value: string) => Number(String(value || "0").replace(/,/g, "").replace(/\s/g, ""));
const toUsdAmount = (value: string, currency: "USD" | "LBP") => {
  const amount = normalizeCurrencyAmount(value);
  return currency === "LBP" ? Number((amount / 100000).toFixed(2)) : amount;
};

type InvoiceTotals = {
  total_collection_usd: number;
  total_wk_fees_usd: number;
  grand_total_usd: number;
  total_collection_lbp: number;
  total_wk_fees_lbp: number;
  grand_total_lbp: number;
};

const emptyInvoiceTotals = (): InvoiceTotals => ({
  total_collection_usd: 0,
  total_wk_fees_usd: 0,
  grand_total_usd: 0,
  total_collection_lbp: 0,
  total_wk_fees_lbp: 0,
  grand_total_lbp: 0,
});

function parseInvoiceTotalsFromText(text: string): InvoiceTotals {
  const read = (currency: "USD" | "LBP", label: string) => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escapedLabel}\\s+${currency}\\s+(-?\\d[\\d,]*(?:\\.\\d+)?)`, "i");
    const match = text.match(pattern);
    return match ? normalizeCurrencyAmount(match[1]) : 0;
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

const parsePdfDate = (value: string | null) => {
  if (!value) return null;
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) return null;
  const year = Number(match[3]) + 2000;
  return `${year}-${match[2]}-${match[1]}`;
};

function parseInvoiceLine(line: string): ParsedInvoiceRow | null {
  const cleaned = line.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.includes("Order Number") || cleaned.startsWith("QUOTI HOME")) return null;

  const moneyMatches = [...cleaned.matchAll(/\b(USD|LBP)\s+(-?\d[\d,]*(?:[.,]\d+)?)/gi)];
  if (moneyMatches.length < 1) return null;

  const firstMoney = moneyMatches[0];
  const secondMoney = moneyMatches[1] || moneyMatches[0];
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
    deliveryFeeUsd: moneyMatches.length > 1 ? toUsdAmount(firstMoney[2], String(firstMoney[1]).toUpperCase() as "USD" | "LBP") : 0,
    collectionUsd: toUsdAmount(secondMoney[2], String(secondMoney[1]).toUpperCase() as "USD" | "LBP"),
    collectionType: typeMatch?.[1] || null,
    area,
    invoiceDate: parsePdfDate(dateMatch?.[1] || null),
    rawLine: cleaned,
  };
}

async function extractInvoiceDataFromPdf(file: File): Promise<{ rows: ParsedInvoiceRow[]; totals: InvoiceTotals }> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const rows: ParsedInvoiceRow[] = [];
  const allLines: string[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = (content.items as any[])
      .map((item) => ({
        str: String(item.str || "").trim(),
        x: item.transform?.[4] || 0,
        y: item.transform?.[5] || 0,
      }))
      .filter((item) => item.str.length > 0);

    const lineMap = new Map<number, typeof items>();
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

function getInvoiceNumberFromName(fileName: string) {
  const dateMatch = fileName.match(/cashbox.*?([A-Za-z]{3}_[A-Za-z]{3}_\d{2},?\d{4}_[0-9_]+)/i);
  return dateMatch?.[1]?.replace(/_/g, " ") || fileName.replace(/\.pdf$/i, "");
}

function base64ToFile(base64: string, fileName: string, mimeType = "application/pdf") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: mimeType });
}

function StatusBadge({ status }: { status: MatchedInvoiceRow["matchStatus"] }) {
  if (status === "newly_paid") return <Badge variant="success">Ready to mark paid</Badge>;
  if (status === "already_paid") return <Badge variant="info">Already paid</Badge>;
  if (status === "amount_adjusted") return <Badge variant="warning">Amount adjusted</Badge>;
  if (status === "rejected_zero_collection") return <Badge variant="warning">Rejected correction</Badge>;
  if (status === "yellow_store_purchase") return <Badge variant="info">Yellow Store purchase</Badge>;
  if (status === "amount_mismatch") return <Badge variant="warning">Amount mismatch</Badge>;
  if (status === "not_delivered") return <Badge variant="warning">Not delivered</Badge>;
  return <Badge variant="destructive">Unmatched</Badge>;
}

export default function WakilniInvoices() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedInvoiceRow[]>([]);
  const [matchedRows, setMatchedRows] = useState<MatchedInvoiceRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [search, setSearch] = useState("");
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveFolderId, setDriveFolderId] = useState("");
  const [sourceDriveFile, setSourceDriveFile] = useState<DriveFile | null>(null);
  const [invoiceTotals, setInvoiceTotals] = useState<InvoiceTotals>(emptyInvoiceTotals);

  const isAdmin = authUser?.role === "admin";

  const { data: deliveredOrders = [] } = useQuery({
    queryKey: ["wakilni-invoice-delivered-orders"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("id, order_id, system_id, customer_name, product_name, quantity, price, total_amount, delivery_status, wakilni_paid_at, wakilni_order_id, wakilni_tracking_id")
        .eq("delivery_status", "delivered")
        .limit(10000);
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin,
  });

  const { data: imports = [] } = useQuery({
    queryKey: ["wakilni-invoice-imports"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("wakilni_invoice_imports")
        .select("*")
        .order("imported_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as ImportHistoryRow[];
    },
    enabled: isAdmin,
  });

  const dashboard = useMemo(() => {
    const deliveredTotal = deliveredOrders.reduce((sum: number, o: any) => sum + Number(o.total_amount || 0), 0);
    const paid = deliveredOrders.filter((o: any) => !!o.wakilni_paid_at);
    const open = deliveredOrders.filter((o: any) => !o.wakilni_paid_at);
    return {
      deliveredCount: deliveredOrders.length,
      deliveredTotal,
      paidCount: paid.length,
      paidTotal: paid.reduce((sum: number, o: any) => sum + Number(o.total_amount || 0), 0),
      openCount: open.length,
      openTotal: open.reduce((sum: number, o: any) => sum + Number(o.total_amount || 0), 0),
      importedAmount: imports.reduce((sum, item) => sum + Number(item.amount_total_usd || 0), 0),
    };
  }, [deliveredOrders, imports]);

  const preview = useMemo(() => {
    return {
      totalRows: matchedRows.length,
      ready: matchedRows.filter((r) => r.matchStatus === "newly_paid").length,
      already: matchedRows.filter((r) => r.matchStatus === "already_paid").length,
      unmatched: matchedRows.filter((r) => r.matchStatus === "unmatched").length,
      warnings: matchedRows.filter((r) => ["amount_adjusted", "rejected_zero_collection", "amount_mismatch", "not_delivered"].includes(r.matchStatus)).length,
      yellowStore: matchedRows.filter((r) => r.matchStatus === "yellow_store_purchase").length,
      yellowStoreAmount: matchedRows
        .filter((r) => r.matchStatus === "yellow_store_purchase")
        .reduce((sum, row) => sum + Math.abs(Number(row.collectionUsd || 0)), 0),
      collection: matchedRows.reduce((sum, row) => sum + Number(row.collectionUsd || 0), 0),
    };
  }, [matchedRows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return matchedRows.slice(0, 100);
    return matchedRows.filter((row) =>
      [row.wakilniOrderId, row.waybill, row.recipientName, row.order?.customer_name, row.order?.product_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    ).slice(0, 100);
  }, [matchedRows, search]);

  async function handlePdfFile(file: File | null, driveFile: DriveFile | null = null) {
    if (!file) return;
    setIsParsing(true);
    setFileName(file.name);
    setSourceDriveFile(driveFile);
    setMatchedRows([]);
    try {
      const { rows, totals } = await extractInvoiceDataFromPdf(file);
      setParsedRows(rows);
      setInvoiceTotals(totals);
      await matchRows(rows);
      toast.success(`Parsed ${rows.length} Wakilni invoice rows`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Could not parse PDF");
    } finally {
      setIsParsing(false);
    }
  }

  const scanDrive = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("wakilni-invoice-drive", {
        body: { action: "list" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { folder_id: string; files: DriveFile[] };
    },
    onSuccess: (data) => {
      setDriveFolderId(data.folder_id);
      setDriveFiles(data.files || []);
      toast.success(`Found ${(data.files || []).length} Wakilni PDF files in Drive`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not scan Google Drive");
    },
  });

  const loadDriveFile = useMutation({
    mutationFn: async (driveFile: DriveFile) => {
      const { data, error } = await supabase.functions.invoke("wakilni-invoice-drive", {
        body: { action: "download", file_id: driveFile.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return { driveFile, file: base64ToFile(data.base64, data.file?.name || driveFile.name, data.file?.mimeType || "application/pdf") };
    },
    onSuccess: ({ driveFile, file }) => {
      void handlePdfFile(file, driveFile);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not load Drive PDF");
    },
  });

  const processLatestDriveFile = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("wakilni-invoice-drive", {
        body: { action: "process-latest" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      if (data?.skipped) {
        toast.info(data.reason || "No new Wakilni invoice PDF found");
      } else {
        toast.success(`${data?.newly_paid_count || 0} orders marked paid from latest Drive invoice`);
      }
      scanDrive.mutate();
      queryClient.invalidateQueries({ queryKey: ["wakilni-invoice-delivered-orders"] });
      queryClient.invalidateQueries({ queryKey: ["wakilni-invoice-imports"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not process latest Drive invoice");
    },
  });

  async function matchRows(rows: ParsedInvoiceRow[]) {
    const wakilniIds = [...new Set(rows.map((r) => r.wakilniOrderId).filter(Boolean))];
    const waybills = [...new Set(rows.map((r) => r.waybill).filter(Boolean))];
    const ordersByWakilni = new Map<string, any>();
    const ordersByWaybill = new Map<string, any>();

    for (let i = 0; i < wakilniIds.length; i += 200) {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("id, order_id, system_id, customer_name, product_name, quantity, price, total_amount, delivery_status, wakilni_paid_at, wakilni_order_id")
        .in("wakilni_order_id", wakilniIds.slice(i, i + 200));
      if (error) throw error;
      (data || []).forEach((order: any) => order.wakilni_order_id && ordersByWakilni.set(String(order.wakilni_order_id), order));
    }

    for (let i = 0; i < waybills.length; i += 200) {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("id, order_id, system_id, customer_name, product_name, quantity, price, total_amount, delivery_status, wakilni_paid_at, wakilni_order_id")
        .in("order_id", waybills.slice(i, i + 200));
      if (error) throw error;
      (data || []).forEach((order: any) => ordersByWaybill.set(String(order.order_id), order));
    }

    const nextRows = rows.map((row) => {
      if (String(row.recipientName || "").toLowerCase().includes("wakilni yellow store")) {
        const amount = Math.abs(Number(row.collectionUsd || 0));
        return { ...row, matchStatus: "yellow_store_purchase", mismatchReason: `Yellow Store product purchase paid by Wakilni (${money(amount)})` } as MatchedInvoiceRow;
      }
      const order = ordersByWakilni.get(row.wakilniOrderId) || (row.waybill ? ordersByWaybill.get(row.waybill) : undefined);
      if (!order) return { ...row, matchStatus: "unmatched", mismatchReason: "No matching order found" } as MatchedInvoiceRow;
      if (Number(row.collectionUsd || 0) <= 0 && order.delivery_status === "delivered") {
        return { ...row, order, matchStatus: "rejected_zero_collection", mismatchReason: "Wakilni collection is 0.00, order should be rejected instead of delivered" } as MatchedInvoiceRow;
      }
      if (order.delivery_status !== "delivered") {
        return { ...row, order, matchStatus: "not_delivered", mismatchReason: `Order status is ${order.delivery_status || "empty"}` } as MatchedInvoiceRow;
      }
      if (order.wakilni_paid_at) return { ...row, order, matchStatus: "already_paid", mismatchReason: null } as MatchedInvoiceRow;
      const expected = Number(order.total_amount || 0);
      if (Math.abs(expected - row.collectionUsd) > 0.05) {
        return { ...row, order, matchStatus: "amount_adjusted", mismatchReason: `System amount adjusted from ${money(expected)} to Wakilni ${money(row.collectionUsd)}` } as MatchedInvoiceRow;
      }
      return { ...row, order, matchStatus: "newly_paid", mismatchReason: null } as MatchedInvoiceRow;
    });

    setMatchedRows(nextRows);
  }

  const applyImport = useMutation({
    mutationFn: async () => {
      if (!fileName || matchedRows.length === 0) throw new Error("Upload and parse a Wakilni invoice first");
      const invoiceNumber = getInvoiceNumberFromName(fileName);
      const rowsToPay = matchedRows.filter((row) => ["newly_paid", "amount_adjusted"].includes(row.matchStatus) && row.order);
      const rowsToReject = matchedRows.filter((row) => row.matchStatus === "rejected_zero_collection" && row.order);
      const warningsCount = matchedRows.filter((row) => ["amount_adjusted", "rejected_zero_collection", "amount_mismatch", "not_delivered"].includes(row.matchStatus)).length;
      const yellowStoreRows = matchedRows.filter((row) => row.matchStatus === "yellow_store_purchase");
      const insertImport = {
        invoice_number: invoiceNumber,
        file_name: fileName,
        google_drive_file_id: sourceDriveFile?.id || null,
        google_drive_file_name: sourceDriveFile?.name || null,
        google_drive_web_view_link: sourceDriveFile?.webViewLink || null,
        imported_by: authUser?.id || null,
        row_count: matchedRows.length,
        matched_count: matchedRows.filter((row) => !!row.order).length,
        newly_paid_count: rowsToPay.length,
        already_paid_count: matchedRows.filter((row) => row.matchStatus === "already_paid").length,
        unmatched_count: matchedRows.filter((row) => row.matchStatus === "unmatched").length,
        warnings_count: warningsCount,
        amount_total_usd: matchedRows.reduce((sum, row) => sum + Number(row.collectionUsd || 0), 0),
        delivery_fee_total_usd: matchedRows.reduce((sum, row) => sum + Number(row.deliveryFeeUsd || 0), 0),
        total_collection_usd: invoiceTotals.total_collection_usd || matchedRows.reduce((sum, row) => sum + Number(row.collectionUsd || 0), 0),
        total_wk_fees_usd: invoiceTotals.total_wk_fees_usd || matchedRows.reduce((sum, row) => sum + Number(row.deliveryFeeUsd || 0), 0),
        grand_total_usd: invoiceTotals.grand_total_usd || 0,
        total_collection_lbp: invoiceTotals.total_collection_lbp || 0,
        total_wk_fees_lbp: invoiceTotals.total_wk_fees_lbp || 0,
        grand_total_lbp: invoiceTotals.grand_total_lbp || 0,
        processing_status: "processed",
        processing_summary: {
          row_count: matchedRows.length,
          matched_count: matchedRows.filter((row) => !!row.order).length,
          newly_paid_count: rowsToPay.length,
          already_paid_count: matchedRows.filter((row) => row.matchStatus === "already_paid").length,
          unmatched_count: matchedRows.filter((row) => row.matchStatus === "unmatched").length,
          warnings_count: warningsCount,
          yellow_store_purchase_count: yellowStoreRows.length,
          yellow_store_purchase_usd: yellowStoreRows.reduce((sum, row) => sum + Math.abs(Number(row.collectionUsd || 0)), 0),
        },
      };

      const { data: importRow, error: importError } = await (supabase as any)
        .from("wakilni_invoice_imports")
        .insert(insertImport)
        .select("id")
        .single();
      if (importError) throw importError;

      const importId = importRow.id as string;
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
        const { error } = await (supabase as any).from("wakilni_invoice_rows").insert(rowPayload.slice(i, i + 500));
        if (error) throw error;
      }

      const now = new Date().toISOString();
      for (let i = 0; i < rowsToReject.length; i += 100) {
        const batch = rowsToReject.slice(i, i + 100);
        await Promise.all(batch.map(async (row) => {
          const { error } = await (supabase as any)
            .from("orders")
            .update({
              delivery_status: "rejected",
              updated_at: now,
              wakilni_invoice_import_id: importId,
              wakilni_invoice_number: invoiceNumber,
              wakilni_invoice_collection_usd: row.collectionUsd,
              wakilni_invoice_delivery_fee_usd: row.deliveryFeeUsd,
              wakilni_invoice_matched_at: now,
            })
            .eq("id", row.order!.id)
            .eq("delivery_status", "delivered");
          if (error) throw error;

          const { error: historyError } = await (supabase as any).from("order_history").insert({
            order_id: row.order!.order_id,
            changed_by: authUser?.id || null,
            changed_by_role: authUser?.role || "admin",
            field_changed: "delivery_status",
            old_value: row.order!.delivery_status,
            new_value: "rejected",
            action_type: "wakilni_invoice_zero_collection",
          });
          if (historyError) throw historyError;
        }));
      }

      for (let i = 0; i < rowsToPay.length; i += 100) {
        const batch = rowsToPay.slice(i, i + 100);
        await Promise.all(batch.map(async (row) => {
          const quantity = Math.max(1, Number(row.order!.quantity || 1));
          const expected = Number(row.order!.total_amount || 0);
          const adjusted = row.matchStatus === "amount_adjusted";
          const nextTotal = Number(row.collectionUsd || 0);
          const nextPrice = Number((nextTotal / quantity).toFixed(2));
          const updatePayload: Record<string, unknown> = {
            wakilni_paid_at: now,
            wakilni_paid_by: authUser?.id || null,
            wakilni_invoice_import_id: importId,
            wakilni_invoice_number: invoiceNumber,
            wakilni_invoice_collection_usd: row.collectionUsd,
            wakilni_invoice_delivery_fee_usd: row.deliveryFeeUsd,
            wakilni_invoice_matched_at: now,
          };
          if (adjusted) {
            updatePayload.total_amount = nextTotal;
            updatePayload.price = nextPrice;
            updatePayload.updated_at = now;
          }

          const { error } = await (supabase as any)
            .from("orders")
            .update(updatePayload)
            .eq("id", row.order!.id)
            .is("wakilni_paid_at", null);
          if (error) throw error;

          if (adjusted) {
            const { error: historyError } = await (supabase as any).from("order_history").insert([
              {
                order_id: row.order!.order_id,
                changed_by: authUser?.id || null,
                changed_by_role: authUser?.role || "admin",
                field_changed: "total_amount",
                old_value: expected.toFixed(2),
                new_value: nextTotal.toFixed(2),
                action_type: "wakilni_invoice_amount_adjustment",
              },
              {
                order_id: row.order!.order_id,
                changed_by: authUser?.id || null,
                changed_by_role: authUser?.role || "admin",
                field_changed: "price",
                old_value: Number(row.order!.price || 0).toFixed(2),
                new_value: nextPrice.toFixed(2),
                action_type: "wakilni_invoice_amount_adjustment",
              },
            ]);
            if (historyError) throw historyError;
          }
        }));
      }

      return { paid: rowsToPay.length };
    },
    onSuccess: ({ paid }) => {
      toast.success(
        paid > 0
          ? `${paid} delivered orders marked as Paid from Wakilni`
          : "Wakilni invoice imported for review. No delivered orders were marked paid.",
      );
      setParsedRows([]);
      setMatchedRows([]);
      setFileName("");
      setSourceDriveFile(null);
      setInvoiceTotals(emptyInvoiceTotals());
      if (driveFiles.length > 0) scanDrive.mutate();
      queryClient.invalidateQueries({ queryKey: ["wakilni-invoice-delivered-orders"] });
      queryClient.invalidateQueries({ queryKey: ["wakilni-invoice-imports"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not apply Wakilni invoice");
    },
  });

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Admin only</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Wakilni invoice reconciliation is only available for admins.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Wakilni Invoices</h1>
        <p className="text-sm text-muted-foreground">Upload Wakilni cashbox PDFs and mark delivered orders as paid from Wakilni.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Delivered Revenue</p>
              <div className="mt-2 text-2xl font-bold">{money(dashboard.deliveredTotal)}</div>
              <p className="mt-1 text-xs text-muted-foreground">{dashboard.deliveredCount} delivered orders</p>
            </div>
            <WalletCards className="h-9 w-9 rounded-lg bg-primary/10 p-2 text-primary" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Paid from Wakilni</p>
              <div className="mt-2 text-2xl font-bold text-success">{money(dashboard.paidTotal)}</div>
              <p className="mt-1 text-xs text-muted-foreground">{dashboard.paidCount} orders marked paid</p>
            </div>
            <CheckCircle2 className="h-9 w-9 rounded-lg bg-success/10 p-2 text-success" />
          </CardContent>
        </Card>
        <Card className={dashboard.openCount > 0 ? "border-warning/40" : ""}>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open Wakilni Receivable</p>
              <div className="mt-2 text-2xl font-bold text-warning">{money(dashboard.openTotal)}</div>
              <p className="mt-1 text-xs text-muted-foreground">{dashboard.openCount} delivered orders unpaid</p>
            </div>
            <AlertTriangle className="h-9 w-9 rounded-lg bg-warning/10 p-2 text-warning" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Imported Cashbox Amount</p>
              <div className="mt-2 text-2xl font-bold">{money(dashboard.importedAmount)}</div>
              <p className="mt-1 text-xs text-muted-foreground">{imports.length} recent imports</p>
            </div>
            <FileCheck2 className="h-9 w-9 rounded-lg bg-info/10 p-2 text-info" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cloud className="h-4 w-4 text-primary" />
            Google Drive Invoices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-muted-foreground">
              New Wakilni invoices are processed automatically every Saturday at 16:00 Beirut time. You can also scan and process Drive files manually.
              {driveFolderId && <span className="ml-1 font-mono text-xs">Folder: {driveFolderId}</span>}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={() => processLatestDriveFile.mutate()} disabled={processLatestDriveFile.isPending || isParsing}>
                <DownloadCloud className="mr-2 h-4 w-4" />
                Process Latest New
              </Button>
              <Button onClick={() => scanDrive.mutate()} disabled={scanDrive.isPending} variant="outline">
                <RefreshCw className={`mr-2 h-4 w-4 ${scanDrive.isPending ? "animate-spin" : ""}`} />
                Scan Drive
              </Button>
            </div>
          </div>

          {driveFiles.length > 0 && (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PDF</TableHead>
                    <TableHead>Modified</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {driveFiles.map((file) => (
                    <TableRow key={file.id}>
                      <TableCell>
                        <div className="font-medium">{file.name}</div>
                        {file.webViewLink && (
                          <a className="text-xs text-primary hover:underline" href={file.webViewLink} target="_blank" rel="noreferrer">
                            Open in Drive
                          </a>
                        )}
                      </TableCell>
                      <TableCell>{file.modifiedTime ? new Date(file.modifiedTime).toLocaleString("en-GB") : "-"}</TableCell>
                      <TableCell>{file.size ? `${(Number(file.size) / 1024).toFixed(0)} KB` : "-"}</TableCell>
                      <TableCell>
                        {file.imported ? (
                          <Badge variant="success">Imported</Badge>
                        ) : (
                          <Badge variant="outline">New</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={file.imported ? "outline" : "default"}
                          onClick={() => loadDriveFile.mutate(file)}
                          disabled={loadDriveFile.isPending || isParsing}
                        >
                          <DownloadCloud className="mr-2 h-4 w-4" />
                          {file.imported ? "Review" : "Process"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileUp className="h-4 w-4 text-primary" />
            Manual Upload Backup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Input
              type="file"
              accept="application/pdf"
              onChange={(event) => void handlePdfFile(event.target.files?.[0] || null)}
              className="md:max-w-md"
            />
            <Button
              onClick={() => void matchRows(parsedRows)}
              variant="outline"
              disabled={parsedRows.length === 0 || isParsing}
            >
              Re-match
            </Button>
            <Button
              onClick={() => applyImport.mutate()}
              disabled={matchedRows.length === 0 || applyImport.isPending}
            >
              {preview.ready > 0 ? "Apply and Mark Paid" : "Import for Review"}
            </Button>
            {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
            {sourceDriveFile && <Badge variant="info">Loaded from Drive</Badge>}
          </div>

          {matchedRows.length > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Rows</p><p className="text-xl font-bold">{preview.totalRows}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Ready</p><p className="text-xl font-bold text-success">{preview.ready}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Already</p><p className="text-xl font-bold text-info">{preview.already}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Warnings</p><p className="text-xl font-bold text-warning">{preview.warnings}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Unmatched</p><p className="text-xl font-bold text-destructive">{preview.unmatched}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Yellow Store</p><p className="text-xl font-bold text-info">{money(preview.yellowStoreAmount)}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Collection</p><p className="text-xl font-bold">{money(preview.collection)}</p></div>
            </div>
          )}

          {matchedRows.length > 0 && (
            <div className="space-y-3">
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search rows..." className="pl-9" />
              </div>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Wakilni Order</TableHead>
                      <TableHead>Waybill</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>System Order</TableHead>
                      <TableHead>Collection</TableHead>
                      <TableHead>Delivery Fee</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map((row, index) => (
                      <TableRow key={`${row.wakilniOrderId}-${row.waybill}-${index}`}>
                        <TableCell className="font-mono text-xs">{row.wakilniOrderId}</TableCell>
                        <TableCell className="font-mono text-xs">{row.waybill ? `#${row.waybill}` : "-"}</TableCell>
                        <TableCell>
                          <div className="font-medium">{row.order?.customer_name || row.recipientName || "-"}</div>
                          <div className="text-xs text-muted-foreground">{row.order?.product_name || row.area}</div>
                        </TableCell>
                        <TableCell>{row.order ? `#${row.order.order_id}` : "-"}</TableCell>
                        <TableCell className="font-semibold">{money(row.collectionUsd)}</TableCell>
                        <TableCell>{money(row.deliveryFeeUsd)}</TableCell>
                        <TableCell><StatusBadge status={row.matchStatus} /></TableCell>
                        <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground" title={row.mismatchReason || ""}>
                          {row.mismatchReason || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {matchedRows.length > visibleRows.length && (
                <p className="text-xs text-muted-foreground">Showing first {visibleRows.length} rows. Use search to narrow the preview.</p>
              )}
            </div>
          )}

          {!isParsing && matchedRows.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Upload a Wakilni cashbox PDF to preview matched delivered orders before applying payment marks.
            </div>
          )}
          {isParsing && <div className="rounded-lg border p-6 text-sm text-muted-foreground">Reading PDF and matching orders...</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Imports</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Imported</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>New Paid</TableHead>
                <TableHead>Already Paid</TableHead>
                <TableHead>Unmatched</TableHead>
                <TableHead>Collection</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{new Date(item.imported_at).toLocaleString("en-GB")}</TableCell>
                  <TableCell>
                    <div className="font-medium">{item.invoice_number || item.file_name}</div>
                    <div className="text-xs text-muted-foreground">{item.file_name}</div>
                  </TableCell>
                  <TableCell>{item.row_count}</TableCell>
                  <TableCell className="text-success">{item.newly_paid_count}</TableCell>
                  <TableCell>{item.already_paid_count}</TableCell>
                  <TableCell className={item.unmatched_count > 0 ? "text-destructive" : ""}>{item.unmatched_count}</TableCell>
                  <TableCell className="font-semibold">{money(Number(item.amount_total_usd || 0))}</TableCell>
                </TableRow>
              ))}
              {imports.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    <XCircle className="mx-auto mb-2 h-5 w-5 opacity-50" />
                    No Wakilni invoice imports yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
