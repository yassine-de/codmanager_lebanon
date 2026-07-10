import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, PackageCheck, RefreshCw, WalletCards } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type WakilniInvoiceImport = {
  id: string;
  invoice_number: string | null;
  file_name: string;
  google_drive_file_name: string | null;
  google_drive_web_view_link: string | null;
  imported_at: string;
  row_count: number;
  matched_count: number;
  newly_paid_count: number;
  already_paid_count: number;
  unmatched_count: number;
  warnings_count: number;
  total_collection_usd: number;
  total_wk_fees_usd: number;
  grand_total_usd: number;
  total_collection_lbp: number;
  total_wk_fees_lbp: number;
  grand_total_lbp: number;
  processing_status: string;
  processing_summary: Record<string, unknown> | null;
};

type WakilniInvoiceIssueRow = {
  id: string;
  import_id: string;
  wakilni_order_id: string | null;
  waybill: string | null;
  recipient_name: string | null;
  delivery_fee_usd: number | null;
  collection_usd: number | null;
  collection_type: string | null;
  area: string | null;
  invoice_date: string | null;
  matched_order_id: string | null;
  match_status: string;
  mismatch_reason: string | null;
};

type WakilniInvoiceYellowStoreRow = {
  import_id: string;
  collection_usd: number | null;
};

const usd = (value: number) =>
  `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;

const lbp = (value: number) =>
  `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} LBP`;

function ResultBadge({ item }: { item: WakilniInvoiceImport }) {
  if (item.unmatched_count > 0 || item.warnings_count > 0) {
    return <Badge variant="warning">{item.unmatched_count + item.warnings_count} issues</Badge>;
  }
  return <Badge variant="success">Clean</Badge>;
}

export default function WakilniInvoiceHistory() {
  const { authUser } = useAuth();
  const [search, setSearch] = useState("");
  const [issueInvoice, setIssueInvoice] = useState<WakilniInvoiceImport | null>(null);
  const isAdmin = authUser?.role === "admin";

  const { data: invoices = [], isFetching, refetch } = useQuery({
    queryKey: ["wakilni-invoice-history"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("wakilni_invoice_imports")
        .select("*")
        .order("imported_at", { ascending: false });
      if (error) throw error;
      return (data || []) as WakilniInvoiceImport[];
    },
    enabled: isAdmin,
  });

  const { data: issueRows = [], isFetching: isFetchingIssues } = useQuery({
    queryKey: ["wakilni-invoice-issues", issueInvoice?.id],
    queryFn: async () => {
      if (!issueInvoice?.id) return [];
      const { data, error } = await (supabase as any)
        .from("wakilni_invoice_rows")
        .select("id,import_id,wakilni_order_id,waybill,recipient_name,delivery_fee_usd,collection_usd,collection_type,area,invoice_date,matched_order_id,match_status,mismatch_reason")
        .eq("import_id", issueInvoice.id)
        .in("match_status", ["unmatched", "not_delivered", "amount_mismatch", "amount_adjusted", "rejected_zero_collection"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as WakilniInvoiceIssueRow[];
    },
    enabled: isAdmin && !!issueInvoice?.id,
  });

  const { data: yellowStoreRows = [] } = useQuery({
    queryKey: ["wakilni-invoice-yellow-store-rows"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("wakilni_invoice_rows")
        .select("import_id,collection_usd")
        .eq("match_status", "yellow_store_purchase");
      if (error) throw error;
      return (data || []) as WakilniInvoiceYellowStoreRow[];
    },
    enabled: isAdmin,
  });

  const yellowStoreByImport = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const row of yellowStoreRows) {
      const current = map.get(row.import_id) || { count: 0, amount: 0 };
      current.count += 1;
      current.amount += Math.abs(Number(row.collection_usd || 0));
      map.set(row.import_id, current);
    }
    return map;
  }, [yellowStoreRows]);

  const visibleInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((item) =>
      [item.invoice_number, item.file_name, item.google_drive_file_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [invoices, search]);

  const totals = useMemo(() => {
    return visibleInvoices.reduce(
      (sum, item) => ({
        count: sum.count + 1,
        rows: sum.rows + Number(item.row_count || 0),
        matched: sum.matched + Number(item.matched_count || 0),
        newlyPaid: sum.newlyPaid + Number(item.newly_paid_count || 0),
        issues: sum.issues + Number(item.unmatched_count || 0) + Number(item.warnings_count || 0),
        collectionUsd: sum.collectionUsd + Number(item.total_collection_usd || 0),
        feesUsd: sum.feesUsd + Number(item.total_wk_fees_usd || 0),
        grandUsd: sum.grandUsd + Number(item.grand_total_usd || 0),
        yellowStoreUsd: sum.yellowStoreUsd + Number(yellowStoreByImport.get(item.id)?.amount || 0),
        yellowStoreCount: sum.yellowStoreCount + Number(yellowStoreByImport.get(item.id)?.count || 0),
        collectionLbp: sum.collectionLbp + Number(item.total_collection_lbp || 0),
        feesLbp: sum.feesLbp + Number(item.total_wk_fees_lbp || 0),
        grandLbp: sum.grandLbp + Number(item.grand_total_lbp || 0),
      }),
      {
        count: 0,
        rows: 0,
        matched: 0,
        newlyPaid: 0,
        issues: 0,
        collectionUsd: 0,
        feesUsd: 0,
        grandUsd: 0,
        yellowStoreUsd: 0,
        yellowStoreCount: 0,
        collectionLbp: 0,
        feesLbp: 0,
        grandLbp: 0,
      },
    );
  }, [visibleInvoices, yellowStoreByImport]);

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Admin only</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Wakilni invoice history is only available for admins.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Wakilni Invoice History</h1>
          <p className="text-sm text-muted-foreground">Review imported Wakilni statements, totals, and processing results.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Grand Total USD</p>
              <div className="mt-2 text-2xl font-bold">{usd(totals.grandUsd)}</div>
              <p className="mt-1 text-xs text-muted-foreground">{totals.count} invoices</p>
            </div>
            <WalletCards className="h-10 w-10 rounded-lg bg-success/10 p-2 text-success" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Grand Total LBP</p>
              <div className="mt-2 text-2xl font-bold">{lbp(totals.grandLbp)}</div>
              <p className="mt-1 text-xs text-muted-foreground">All imported LBP statements</p>
            </div>
            <FileText className="h-10 w-10 rounded-lg bg-info/10 p-2 text-info" />
          </CardContent>
        </Card>
        <Card className={totals.issues > 0 ? "border-warning/50" : ""}>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Import Issues</p>
              <div className="mt-2 text-2xl font-bold">{totals.issues}</div>
              <p className="mt-1 text-xs text-muted-foreground">{totals.matched} matched rows</p>
            </div>
            {totals.issues > 0 ? (
              <AlertTriangle className="h-10 w-10 rounded-lg bg-warning/10 p-2 text-warning" />
            ) : (
              <CheckCircle2 className="h-10 w-10 rounded-lg bg-success/10 p-2 text-success" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Yellow Store Purchases</p>
              <div className="mt-2 text-2xl font-bold">{usd(totals.yellowStoreUsd)}</div>
              <p className="mt-1 text-xs text-muted-foreground">{totals.yellowStoreCount} invoice rows</p>
            </div>
            <PackageCheck className="h-10 w-10 rounded-lg bg-info/10 p-2 text-info" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-base">All Wakilni Invoices</CardTitle>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search invoice..."
            className="md:max-w-xs"
          />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Imported</TableHead>
                <TableHead className="text-right">Total Collection USD</TableHead>
                <TableHead className="text-right">Total WK Fees USD</TableHead>
                <TableHead className="text-right">Yellow Store USD</TableHead>
                <TableHead className="text-right">Grand Total USD</TableHead>
                <TableHead className="text-right">Total Collection LBP</TableHead>
                <TableHead className="text-right">Total WK Fees LBP</TableHead>
                <TableHead className="text-right">Grand Total LBP</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleInvoices.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium">{item.invoice_number || item.file_name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{item.file_name}</span>
                      {item.google_drive_web_view_link && (
                        <a href={item.google_drive_web_view_link} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          <ExternalLink className="inline h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.row_count} rows, {item.newly_paid_count} new paid, {item.already_paid_count} already paid
                    </div>
                  </TableCell>
                  <TableCell>{new Date(item.imported_at).toLocaleString("en-GB")}</TableCell>
                  <TableCell className="text-right font-semibold">{usd(Number(item.total_collection_usd || 0))}</TableCell>
                  <TableCell className="text-right">{usd(Number(item.total_wk_fees_usd || 0))}</TableCell>
                  <TableCell className="text-right">{usd(Number(yellowStoreByImport.get(item.id)?.amount || 0))}</TableCell>
                  <TableCell className="text-right font-semibold text-success">{usd(Number(item.grand_total_usd || 0))}</TableCell>
                  <TableCell className="text-right">{lbp(Number(item.total_collection_lbp || 0))}</TableCell>
                  <TableCell className="text-right">{lbp(Number(item.total_wk_fees_lbp || 0))}</TableCell>
                  <TableCell className="text-right font-semibold">{lbp(Number(item.grand_total_lbp || 0))}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {item.unmatched_count > 0 || item.warnings_count > 0 ? (
                        <button
                          type="button"
                          onClick={() => setIssueInvoice(item)}
                          className="text-left text-warning underline-offset-2 hover:underline"
                        >
                          <ResultBadge item={item} />
                        </button>
                      ) : (
                        <ResultBadge item={item} />
                      )}
                      {(item.unmatched_count > 0 || item.warnings_count > 0) && (
                        <div className="text-xs text-muted-foreground">
                          {item.unmatched_count} unmatched, {item.warnings_count} warnings
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visibleInvoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-12 text-center text-muted-foreground">
                    No Wakilni invoices found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {visibleInvoices.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right">{usd(totals.collectionUsd)}</TableCell>
                  <TableCell className="text-right">{usd(totals.feesUsd)}</TableCell>
                  <TableCell className="text-right">{usd(totals.yellowStoreUsd)}</TableCell>
                  <TableCell className="text-right font-bold">{usd(totals.grandUsd)}</TableCell>
                  <TableCell className="text-right">{lbp(totals.collectionLbp)}</TableCell>
                  <TableCell className="text-right">{lbp(totals.feesLbp)}</TableCell>
                  <TableCell className="text-right font-bold">{lbp(totals.grandLbp)}</TableCell>
                  <TableCell>{totals.issues} issues</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!issueInvoice} onOpenChange={(open) => !open && setIssueInvoice(null)}>
        <DialogContent className="max-w-[1100px]">
          <DialogHeader>
            <DialogTitle>Wakilni Invoice Issues</DialogTitle>
            <DialogDescription>
              {issueInvoice?.invoice_number || issueInvoice?.file_name || "Invoice"} - rows that could not be cleanly reconciled.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Unmatched</p>
              <p className="text-xl font-bold text-destructive">{issueInvoice?.unmatched_count || 0}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Warnings</p>
              <p className="text-xl font-bold text-warning">{issueInvoice?.warnings_count || 0}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Total Issues</p>
              <p className="text-xl font-bold">{(issueInvoice?.unmatched_count || 0) + (issueInvoice?.warnings_count || 0)}</p>
            </div>
          </div>
          <ScrollArea className="max-h-[60vh] rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wakilni Order</TableHead>
                  <TableHead>Waybill</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Collection</TableHead>
                  <TableHead className="text-right">WK Fee</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issueRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.wakilni_order_id || "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.waybill ? `#${row.waybill}` : "-"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{row.recipient_name || "-"}</div>
                      <div className="max-w-[240px] truncate text-xs text-muted-foreground" title={row.area || ""}>{row.area || "-"}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.match_status === "unmatched" ? "destructive" : "warning"}>
                        {row.match_status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                      {row.mismatch_reason || "-"}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{usd(Number(row.collection_usd || 0))}</TableCell>
                    <TableCell className="text-right">{usd(Number(row.delivery_fee_usd || 0))}</TableCell>
                  </TableRow>
                ))}
                {issueRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      {isFetchingIssues ? "Loading issue rows..." : "No issue rows found for this invoice."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
