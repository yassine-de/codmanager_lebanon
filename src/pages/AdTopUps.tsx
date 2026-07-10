import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, Calendar, CheckCircle2, Clock, Loader2, Plus, ReceiptText, Search, Wallet, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatUSD } from "@/lib/currency";
import { formatPKT as format } from "@/lib/timezone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchableSelect } from "@/components/SearchableSelect";
import { toast } from "sonner";

type AdTopUpStatus = "open" | "invoiced" | "paid" | "cancelled";

interface AdTopUp {
  id: string;
  seller_id: string;
  invoice_id: string | null;
  invoice_addon_id: string | null;
  ad_account_name: string;
  amount_usd: number;
  topup_date: string;
  note: string | null;
  source: string;
  status: AdTopUpStatus;
  created_at: string;
}

interface SellerProfile {
  user_id: string;
  name: string;
}

const statusConfig: Record<AdTopUpStatus, { label: string; className: string; icon: typeof Clock }> = {
  open: { label: "Open", className: "bg-warning/10 text-warning border-warning/30", icon: Clock },
  invoiced: { label: "Invoiced", className: "bg-info/10 text-info border-info/30", icon: ReceiptText },
  paid: { label: "Paid", className: "bg-success/10 text-success border-success/30", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", className: "bg-destructive/10 text-destructive border-destructive/30", icon: XCircle },
};

function TopUpStatusBadge({ status }: { status: AdTopUpStatus }) {
  const cfg = statusConfig[status] || statusConfig.open;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

export default function AdTopUps() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = authUser?.role === "admin";
  const [sellerId, setSellerId] = useState("");
  const [amount, setAmount] = useState("");
  const [adAccountName, setAdAccountName] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");

  const { data: sellers = [] } = useQuery({
    queryKey: ["ad-topup-sellers"],
    queryFn: async () => {
      const { data: roles, error: roleError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "seller");
      if (roleError) throw roleError;

      const ids = (roles || []).map((role) => role.user_id);
      if (ids.length === 0) return [] as SellerProfile[];

      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", ids)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as SellerProfile[];
    },
    enabled: isAdmin,
  });

  const sellerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    sellers.forEach((seller) => { map[seller.user_id] = seller.name; });
    if (authUser) map[authUser.id] = authUser.name;
    return map;
  }, [authUser, sellers]);

  const sellerOptions = useMemo(() => sellers.map((seller) => ({
    value: seller.user_id,
    label: seller.name || seller.user_id.slice(0, 8),
  })), [sellers]);

  const { data: topUps = [], isLoading } = useQuery({
    queryKey: ["ad-topups", authUser?.id, isAdmin],
    queryFn: async () => {
      let query = (supabase as any)
        .from("ad_topups")
        .select("id, seller_id, invoice_id, invoice_addon_id, ad_account_name, amount_usd, topup_date, note, source, status, created_at")
        .order("topup_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (!isAdmin && authUser?.id) query = query.eq("seller_id", authUser.id);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as AdTopUp[];
    },
    enabled: !!authUser,
  });

  const filteredTopUps = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return topUps;
    return topUps.filter((topUp) => {
      const sellerName = sellerNameMap[topUp.seller_id] || "";
      return topUp.ad_account_name.toLowerCase().includes(q)
        || sellerName.toLowerCase().includes(q)
        || topUp.status.toLowerCase().includes(q)
        || String(topUp.amount_usd).includes(q);
    });
  }, [search, sellerNameMap, topUps]);

  const stats = useMemo(() => {
    const open = topUps.filter((topUp) => topUp.status === "open").reduce((sum, topUp) => sum + Number(topUp.amount_usd || 0), 0);
    const invoiced = topUps.filter((topUp) => topUp.status === "invoiced").reduce((sum, topUp) => sum + Number(topUp.amount_usd || 0), 0);
    const paid = topUps.filter((topUp) => topUp.status === "paid").reduce((sum, topUp) => sum + Number(topUp.amount_usd || 0), 0);
    return { open, invoiced, paid, count: topUps.length };
  }, [topUps]);

  const resetForm = () => {
    setAmount("");
    setAdAccountName("");
    setNote("");
  };

  const createTopUpMutation = useMutation({
    mutationFn: async () => {
      if (!sellerId || sellerId === "all") throw new Error("Please choose a seller");
      const amountUsd = Number(amount.replace(",", "."));
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error("Please enter a valid amount");
      if (!adAccountName.trim()) throw new Error("Please enter the ad account name");

      const { data: existingOpen, error: invoiceLookupError } = await supabase
        .from("invoices")
        .select("id")
        .eq("seller_id", sellerId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (invoiceLookupError) throw invoiceLookupError;

      let invoiceId = existingOpen?.id;
      if (!invoiceId) {
        const { data: newInvoice, error: invoiceCreateError } = await supabase
          .from("invoices")
          .insert({ seller_id: sellerId, status: "open" } as any)
          .select("id")
          .single();
        if (invoiceCreateError) throw invoiceCreateError;
        invoiceId = newInvoice.id;
      }

      const reason = `Ad Top-up - ${adAccountName.trim()}`;
      const { data: addon, error: addonError } = await supabase
        .from("invoice_addons")
        .insert({
          invoice_id: invoiceId,
          type: "out",
          amount: amountUsd,
          reason,
        })
        .select("id")
        .single();
      if (addonError) throw addonError;

      const { error: topUpError } = await (supabase as any)
        .from("ad_topups")
        .insert({
          seller_id: sellerId,
          invoice_id: invoiceId,
          invoice_addon_id: addon.id,
          created_by: authUser?.id ?? null,
          ad_account_name: adAccountName.trim(),
          amount_usd: amountUsd,
          topup_date: new Date().toISOString().slice(0, 10),
          note: note.trim() || null,
          source: "manual",
          status: "open",
        });
      if (topUpError) throw topUpError;
    },
    onSuccess: () => {
      toast.success("Ad top-up saved");
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["ad-topups"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-summaries"] });
      queryClient.invalidateQueries({ queryKey: ["seller-ad-topup-summary"] });
    },
    onError: (error: any) => toast.error(error.message || "Failed to save ad top-up"),
  });

  return (
    <div className="max-w-6xl space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Ad Top-ups</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {isAdmin ? "Capture seller ad-account top-ups and include them in invoices." : "Your ad-account top-ups and invoice status."}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search top-ups..." className="h-11 sm:h-9 pl-9" />
        </div>
      </div>

      {isAdmin && (
        <Card className="border-primary/20">
          <CardContent className="p-3 sm:p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold sm:hidden">
              <BadgeDollarSign className="h-4 w-4 text-primary" />
              Quick Add
            </div>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[1.1fr_0.8fr_1.2fr]">
              <SearchableSelect
                value={sellerId}
                onValueChange={setSellerId}
                options={sellerOptions}
                placeholder="Seller"
                allLabel="Choose seller"
                className="h-12 sm:h-9 w-full"
              />
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="Amount USD"
                className="h-12 sm:h-9 text-base sm:text-xs"
              />
              <Input
                value={adAccountName}
                onChange={(event) => setAdAccountName(event.target.value)}
                placeholder="Ad account name"
                className="h-12 sm:h-9 text-base sm:text-xs"
              />
            </div>
            <div className="mt-2.5 grid grid-cols-1 gap-2.5 md:grid-cols-[1fr_auto]">
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Note, e.g. personal WhatsApp"
                className="min-h-[72px] sm:min-h-[42px] text-base sm:text-xs"
              />
              <Button onClick={() => createTopUpMutation.mutate()} disabled={createTopUpMutation.isPending} className="h-12 sm:h-[42px] gap-2 text-sm">
                {createTopUpMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Save Top-up
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Card>
          <CardContent className="p-2.5 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div className="rounded-lg bg-warning/10 p-1.5 sm:p-2 text-warning w-fit"><Clock className="h-4 w-4" /></div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Open</p>
              <p className="text-sm sm:text-xl font-bold tabular-nums truncate">{formatUSD(stats.open)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-2.5 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div className="rounded-lg bg-info/10 p-1.5 sm:p-2 text-info w-fit"><ReceiptText className="h-4 w-4" /></div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Invoiced</p>
              <p className="text-sm sm:text-xl font-bold tabular-nums truncate">{formatUSD(stats.invoiced)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-2.5 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div className="rounded-lg bg-success/10 p-1.5 sm:p-2 text-success w-fit"><Wallet className="h-4 w-4" /></div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Paid</p>
              <p className="text-sm sm:text-xl font-bold tabular-nums truncate">{formatUSD(stats.paid)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="hidden sm:block">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {isAdmin && <TableHead>Seller</TableHead>}
                  <TableHead>Date</TableHead>
                  <TableHead>Ad Account</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTopUps.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 6 : 5} className="h-24 text-center text-sm text-muted-foreground">
                      No ad top-ups found.
                    </TableCell>
                  </TableRow>
                ) : filteredTopUps.map((topUp) => (
                  <TableRow key={topUp.id}>
                    {isAdmin && <TableCell className="font-medium">{sellerNameMap[topUp.seller_id] || topUp.seller_id.slice(0, 8)}</TableCell>}
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(new Date(topUp.topup_date), "dd MMM yyyy")}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{topUp.ad_account_name}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatUSD(Number(topUp.amount_usd || 0))}</TableCell>
                    <TableCell><TopUpStatusBadge status={topUp.status} /></TableCell>
                    <TableCell className="max-w-[260px] truncate text-muted-foreground">{topUp.note || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2 sm:hidden">
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : filteredTopUps.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No ad top-ups found.
            </CardContent>
          </Card>
        ) : filteredTopUps.map((topUp) => (
          <Card key={topUp.id}>
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{topUp.ad_account_name}</p>
                  {isAdmin && (
                    <p className="text-xs text-muted-foreground truncate">
                      {sellerNameMap[topUp.seller_id] || topUp.seller_id.slice(0, 8)}
                    </p>
                  )}
                </div>
                <p className="font-bold tabular-nums shrink-0">{formatUSD(Number(topUp.amount_usd || 0))}</p>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  {format(new Date(topUp.topup_date), "dd MMM yyyy")}
                </span>
                <TopUpStatusBadge status={topUp.status} />
              </div>
              {topUp.note && (
                <p className="mt-2 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
                  {topUp.note}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
