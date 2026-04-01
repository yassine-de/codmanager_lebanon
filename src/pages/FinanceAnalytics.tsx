import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { SearchableSelect } from "@/components/SearchableSelect";
import { KPICard } from "@/components/KPICard";
import { Truck, DollarSign, ChevronDown, CheckCircle2, Wallet, Loader2, XCircle, Package, CreditCard, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatUSD, pkrToUsd } from "@/lib/currency";
import { DateRange } from "react-day-picker";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { supabase } from "@/integrations/supabase/client";

export default function FinanceAnalytics() {
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["finance-analytics-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_id, confirmation_status, delivery_status, product_name, seller_id, price, quantity, total_amount, shipping_cost, weight, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-for-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, name");
      if (error) throw error;
      return data;
    },
  });

  const { data: sellerRatesData = [] } = useQuery({
    queryKey: ["seller-rates-finance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("seller_rates").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: sourcingRequests = [] } = useQuery({
    queryKey: ["finance-sourcing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sourcing_requests")
        .select("id, seller_id, product_name, quantity, unit_price, shipping_cost, total_price, seller_price, payment_status, seller_validated, status, created_at");
      if (error) throw error;
      return data;
    },
  });

  const { data: rateSettingsFinance = [] } = useQuery({
    queryKey: ["rate-settings-finance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("rate_settings").select("seller_id, cod_fee_per_delivery, confirmed_order_rate, dropped_order_rate, is_global, is_custom");
      if (error) throw error;
      return data;
    },
  });

  const rateHelpers = useMemo(() => {
    const globalRate = rateSettingsFinance.find(r => r.is_global && !r.seller_id);
    const globalCod = (globalRate?.cod_fee_per_delivery ?? 5) / 100;
    const globalConfirmed = globalRate?.confirmed_order_rate ?? 0.3;
    const globalDropped = globalRate?.dropped_order_rate ?? 0.2;
    const sellerCodMap: Record<string, number> = {};
    const sellerConfirmedMap: Record<string, number> = {};
    const sellerDroppedMap: Record<string, number> = {};
    rateSettingsFinance.forEach(r => {
      if (r.seller_id) {
        sellerCodMap[r.seller_id] = r.cod_fee_per_delivery / 100;
        sellerConfirmedMap[r.seller_id] = r.confirmed_order_rate;
        sellerDroppedMap[r.seller_id] = r.dropped_order_rate;
      }
    });
    return {
      getCodRate: (sellerId: string) => sellerCodMap[sellerId] ?? globalCod,
      getConfirmedRate: (sellerId: string) => sellerConfirmedMap[sellerId] ?? globalConfirmed,
      getDroppedRate: (sellerId: string) => sellerDroppedMap[sellerId] ?? globalDropped,
      globalConfirmedRate: globalConfirmed,
      globalDroppedRate: globalDropped,
      globalCodPercent: (globalRate?.cod_fee_per_delivery ?? 5),
    };
  }, [rateSettingsFinance]);

  const getShippingFee = useMemo(() => {
    const rateMap: Record<string, { rate_1kg: number; rate_2kg: number; rate_3kg: number; rate_3kg_plus: number }> = {};
    sellerRatesData.forEach(r => {
      rateMap[r.user_id] = { rate_1kg: r.rate_1kg, rate_2kg: r.rate_2kg, rate_3kg: r.rate_3kg, rate_3kg_plus: r.rate_3kg_plus };
    });
    return (sellerId: string, weightKg: number) => {
      const rates = rateMap[sellerId];
      if (!rates) return 3;
      if (weightKg <= 1) return rates.rate_1kg;
      if (weightKg <= 2) return rates.rate_2kg;
      if (weightKg <= 3) return rates.rate_3kg;
      return rates.rate_3kg_plus;
    };
  }, [sellerRatesData]);

  const profileNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    profiles.forEach(p => { map[p.user_id] = p.name; });
    return map;
  }, [profiles]);

  const sellerOptions = useMemo(() => {
    const ids = new Set([...orders.map(o => o.seller_id), ...sourcingRequests.map(s => s.seller_id)]);
    return [...ids].map(id => ({ value: id, label: profileNameMap[id] || id.slice(0, 8) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, sourcingRequests, profileNameMap]);

  const productOptions = useMemo(() => {
    const names = new Set([...orders.map(o => o.product_name).filter(Boolean), ...sourcingRequests.map(s => s.product_name).filter(Boolean)]);
    return [...names].map(n => ({ value: n, label: n })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, sourcingRequests]);

  const filteredOrders = useMemo(() => {
    let filtered = [...orders];
    if (sellerFilter !== "all") filtered = filtered.filter(o => o.seller_id === sellerFilter);
    if (productFilter !== "all") filtered = filtered.filter(o => o.product_name === productFilter);
    if (dateRange?.from) filtered = filtered.filter(o => new Date(o.created_at) >= dateRange.from!);
    if (dateRange?.to) filtered = filtered.filter(o => new Date(o.created_at) <= dateRange.to!);
    return filtered;
  }, [orders, sellerFilter, productFilter, dateRange]);

  // Only validated sourcing requests count for profit
  const filteredSourcing = useMemo(() => {
    let filtered = sourcingRequests.filter(r => r.seller_validated === true);
    if (sellerFilter !== "all") filtered = filtered.filter(r => r.seller_id === sellerFilter);
    if (productFilter !== "all") filtered = filtered.filter(r => r.product_name === productFilter);
    if (dateRange?.from) filtered = filtered.filter(r => new Date(r.created_at) >= dateRange.from!);
    if (dateRange?.to) filtered = filtered.filter(r => new Date(r.created_at) <= dateRange.to!);
    return filtered;
  }, [sourcingRequests, sellerFilter, productFilter, dateRange]);

  // === CALCULATIONS ===

  const shippedOrders = useMemo(() => {
    return filteredOrders.filter(o => o.delivery_status && ["shipped", "in_transit", "with_courier", "delivered", "paid", "returned", "pending"].includes(o.delivery_status));
  }, [filteredOrders]);

  const shippingRevenue = useMemo(() => {
    return shippedOrders.reduce((sum, o) => {
      const weight = Number(o.weight) || 0.5;
      return sum + getShippingFee(o.seller_id, weight);
    }, 0);
  }, [shippedOrders, getShippingFee]);

  const confirmationStats = useMemo(() => {
    const confirmedOrders = filteredOrders.filter(o => o.confirmation_status === "confirmed");
    const droppedOrders = filteredOrders.filter(o => ["cancelled", "wrong_number", "double"].includes(o.confirmation_status));
    const confirmedRevenue = confirmedOrders.reduce((sum, o) => sum + rateHelpers.getConfirmedRate(o.seller_id), 0);
    const droppedRevenue = droppedOrders.reduce((sum, o) => sum + rateHelpers.getDroppedRate(o.seller_id), 0);
    return { confirmedCount: confirmedOrders.length, droppedCount: droppedOrders.length, confirmedRevenue, droppedRevenue, totalRevenue: confirmedRevenue + droppedRevenue };
  }, [filteredOrders, rateHelpers]);

  const codStats = useMemo(() => {
    const deliveredOrders = filteredOrders.filter(o => o.delivery_status === "delivered" || o.delivery_status === "paid");
    const deliveredRevenuePKR = deliveredOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
    const deliveredRevenueUSD = pkrToUsd(deliveredRevenuePKR);
    const codFees = deliveredOrders.reduce((sum, o) => sum + pkrToUsd(Number(o.total_amount)) * rateHelpers.getCodRate(o.seller_id), 0);
    return { deliveredRevenueUSD, codFees, deliveredCount: deliveredOrders.length };
  }, [filteredOrders, rateHelpers]);

  // Sourcing: profit = (seller_price * quantity) - total_price, split by payment status
  const sourcingStats = useMemo(() => {
    let totalProfit = 0;
    let totalAmount = 0; // total seller owes (seller_price * qty)
    let paidAmount = 0;
    let unpaidAmount = 0;
    let paidProfit = 0;
    let unpaidProfit = 0;
    let totalUnits = 0;

    filteredSourcing.forEach(r => {
      const sellerOwes = (r.seller_price || 0) * r.quantity;
      const ourCost = r.total_price || 0;
      const profit = sellerOwes - ourCost;

      totalAmount += sellerOwes;
      totalProfit += profit;
      totalUnits += r.quantity;

      if (r.payment_status === 'paid') {
        paidAmount += sellerOwes;
        paidProfit += profit;
      } else {
        unpaidAmount += sellerOwes;
        unpaidProfit += profit;
      }
    });

    return { totalProfit, totalAmount, paidAmount, unpaidAmount, paidProfit, unpaidProfit, totalUnits, count: filteredSourcing.length };
  }, [filteredSourcing]);

  const totalRevenueUSD = shippingRevenue + confirmationStats.totalRevenue + codStats.codFees + sourcingStats.totalProfit;

  // Revenue by seller
  const profitBySeller = useMemo(() => {
    const map: Record<string, { shipping: number; confirmation: number; cod: number; sourcing: number }> = {};
    filteredOrders.forEach(o => {
      const id = o.seller_id;
      if (!map[id]) map[id] = { shipping: 0, confirmation: 0, cod: 0, sourcing: 0 };
      if (o.delivery_status && ["shipped", "in_transit", "with_courier", "delivered", "paid", "returned", "pending"].includes(o.delivery_status)) {
        map[id].shipping += getShippingFee(id, Number(o.weight) || 0.5);
      }
      if (o.confirmation_status === "confirmed") map[id].confirmation += rateHelpers.getConfirmedRate(id);
      else if (["cancelled", "wrong_number", "double"].includes(o.confirmation_status)) map[id].confirmation += rateHelpers.getDroppedRate(id);
      if (o.delivery_status === "delivered" || o.delivery_status === "paid") map[id].cod += pkrToUsd(Number(o.total_amount)) * rateHelpers.getCodRate(id);
    });
    filteredSourcing.forEach(r => {
      const id = r.seller_id;
      if (!map[id]) map[id] = { shipping: 0, confirmation: 0, cod: 0, sourcing: 0 };
      map[id].sourcing += ((r.seller_price || 0) * r.quantity) - (r.total_price || 0);
    });
    return Object.entries(map)
      .map(([id, d]) => ({
        name: profileNameMap[id] || id.slice(0, 8),
        total: Math.round((d.shipping + d.confirmation + d.cod + d.sourcing) * 100) / 100,
        shipping: Math.round(d.shipping * 100) / 100,
        confirmation: Math.round(d.confirmation * 100) / 100,
        cod: Math.round(d.cod * 100) / 100,
        sourcing: Math.round(d.sourcing * 100) / 100,
      }))
      .sort((a, b) => b.total - a.total);
  }, [filteredOrders, filteredSourcing, profileNameMap, getShippingFee, rateHelpers]);

  const profitByProduct = useMemo(() => {
    const map: Record<string, { revenue: number; count: number }> = {};
    filteredOrders.forEach(o => {
      if (o.delivery_status === "delivered" || o.delivery_status === "paid") {
        const name = o.product_name || "Unknown";
        if (!map[name]) map[name] = { revenue: 0, count: 0 };
        map[name].revenue += Number(o.total_amount);
        map[name].count += o.quantity;
      }
    });
    return Object.entries(map).map(([name, d]) => ({ name, revenue: d.revenue, count: d.count })).sort((a, b) => b.revenue - a.revenue);
  }, [filteredOrders]);

  const chartColors = ['hsl(var(--primary))', 'hsl(155, 50%, 42%)', 'hsl(38, 90%, 55%)', 'hsl(0, 65%, 52%)', 'hsl(220, 70%, 55%)'];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Detail table rows
  const detailRows = [
    {
      category: "Shipping",
      icon: Truck,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      description: `${shippedOrders.length} shipped orders × weight-based rates`,
      total: shippingRevenue,
      paid: shippingRevenue, // shipping is always charged
      pending: 0,
    },
    {
      category: "Call Center — Confirmed",
      icon: CheckCircle2,
      iconBg: "bg-success/10",
      iconColor: "text-success",
      description: `${confirmationStats.confirmedCount} orders × $${rateHelpers.globalConfirmedRate}`,
      total: confirmationStats.confirmedRevenue,
      paid: confirmationStats.confirmedRevenue,
      pending: 0,
    },
    {
      category: "Call Center — Dropped",
      icon: XCircle,
      iconBg: "bg-destructive/10",
      iconColor: "text-destructive",
      description: `${confirmationStats.droppedCount} orders × $${rateHelpers.globalDroppedRate}`,
      total: confirmationStats.droppedRevenue,
      paid: confirmationStats.droppedRevenue,
      pending: 0,
    },
    {
      category: "COD Fees",
      icon: DollarSign,
      iconBg: "bg-warning/10",
      iconColor: "text-warning",
      description: `${rateHelpers.globalCodPercent}% of ${formatUSD(codStats.deliveredRevenueUSD)} (${codStats.deliveredCount} delivered)`,
      total: codStats.codFees,
      paid: codStats.codFees,
      pending: 0,
    },
    {
      category: "Sourcing Profit",
      icon: Package,
      iconBg: "bg-info/10",
      iconColor: "text-info",
      description: `${sourcingStats.count} validated requests · ${sourcingStats.totalUnits} units`,
      total: sourcingStats.totalProfit,
      paid: sourcingStats.paidProfit,
      pending: sourcingStats.unpaidProfit,
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold">Finance</h1>
        <p className="text-muted-foreground text-sm mt-1">Exact revenue breakdown from shipping, call center, COD fees & sourcing</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-card rounded-lg border p-4">
        <SearchableSelect value={sellerFilter} onValueChange={setSellerFilter}
          options={sellerOptions} placeholder="Seller" allLabel="All Sellers" className="w-[180px]" />
        <SearchableSelect value={productFilter} onValueChange={setProductFilter}
          options={productOptions} placeholder="Product" allLabel="All Products" className="w-[180px]" />
        <DatePresetFilter dateRange={dateRange} onDateRangeChange={setDateRange} preset={datePreset} onPresetChange={setDatePreset} />
        {(sellerFilter !== "all" || productFilter !== "all" || dateRange) && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setSellerFilter("all"); setProductFilter("all"); setDatePreset("maximum"); setDateRange(undefined); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Total Revenue Hero */}
      <div className="bg-gradient-to-br from-primary/10 via-card to-success/10 rounded-xl border-2 border-primary/20 p-6 animate-slide-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-xl bg-primary/15">
            <Wallet className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground font-medium">Total Revenue</p>
            <p className="text-3xl font-bold tabular-nums tracking-tight">{formatUSD(totalRevenueUSD)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Shipping</p>
            <p className="text-lg font-bold tabular-nums">{formatUSD(shippingRevenue)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{shippedOrders.length} shipped</p>
          </div>
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Call Center</p>
            <p className="text-lg font-bold tabular-nums">{formatUSD(confirmationStats.totalRevenue)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{confirmationStats.confirmedCount + confirmationStats.droppedCount} processed</p>
          </div>
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">COD Fees</p>
            <p className="text-lg font-bold tabular-nums">{formatUSD(codStats.codFees)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{codStats.deliveredCount} delivered</p>
          </div>
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Sourcing</p>
            <p className="text-lg font-bold tabular-nums">{formatUSD(sourcingStats.totalProfit)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              <span className="text-success">{formatUSD(sourcingStats.paidProfit)} paid</span>
              {sourcingStats.unpaidProfit > 0 && <span className="text-warning"> · {formatUSD(sourcingStats.unpaidProfit)} pending</span>}
            </p>
          </div>
        </div>
      </div>

      {/* KPIs row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Shipping Revenue" value={formatUSD(shippingRevenue)} subtitle={`${shippedOrders.length} orders`} icon={Truck} iconBg="bg-primary/10" iconColor="text-primary" delay={0} />
        <KPICard title="Call Center" value={formatUSD(confirmationStats.totalRevenue)} subtitle={`${confirmationStats.confirmedCount} confirmed · ${confirmationStats.droppedCount} dropped`} icon={CheckCircle2} iconBg="bg-success/10" iconColor="text-success" delay={50} />
        <KPICard title="COD Fees" value={formatUSD(codStats.codFees)} subtitle={`${rateHelpers.globalCodPercent}% of ${formatUSD(codStats.deliveredRevenueUSD)}`} icon={DollarSign} iconBg="bg-warning/10" iconColor="text-warning" delay={100} />
        <KPICard title="Sourcing Profit" value={formatUSD(sourcingStats.totalProfit)} subtitle={`${sourcingStats.count} requests · ${sourcingStats.totalUnits} units`} icon={Package} iconBg="bg-info/10" iconColor="text-info" delay={150} />
      </div>

      {/* Sourcing Payment Breakdown */}
      <div className="bg-card rounded-xl border p-5 animate-slide-up" style={{ animationDelay: '80ms' }}>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Sourcing Payment Overview</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-muted/30 to-muted/10 p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-foreground/5"><Package className="w-4 h-4 text-foreground/70" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Amount</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">{formatUSD(sourcingStats.totalAmount)}</p>
            <p className="text-xs text-muted-foreground mt-1">{sourcingStats.totalUnits} units across {sourcingStats.count} requests</p>
          </div>
          <div className="relative overflow-hidden rounded-xl border border-success/20 bg-gradient-to-br from-success/5 to-transparent p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-success/10"><CreditCard className="w-4 h-4 text-success" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Paid</span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-success">{formatUSD(sourcingStats.paidAmount)}</p>
            <p className="text-xs text-muted-foreground mt-1">Profit: {formatUSD(sourcingStats.paidProfit)}</p>
          </div>
          <div className="relative overflow-hidden rounded-xl border border-warning/20 bg-gradient-to-br from-warning/5 to-transparent p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-warning/10"><Clock className="w-4 h-4 text-warning" /></div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending</span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-warning">{formatUSD(sourcingStats.unpaidAmount)}</p>
            <p className="text-xs text-muted-foreground mt-1">Profit: {formatUSD(sourcingStats.unpaidProfit)}</p>
          </div>
        </div>
      </div>

      {/* Revenue Breakdown Table */}
      <div className="bg-card rounded-xl border overflow-hidden animate-slide-up" style={{ animationDelay: '120ms' }}>
        <div className="px-5 py-4 border-b bg-muted/30">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Revenue Breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/20">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Category</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 hidden md:table-cell">Details</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Total</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Paid</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Pending</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {detailRows.map((row) => {
                const Icon = row.icon;
                return (
                  <tr key={row.category} className="hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn("p-2 rounded-lg", row.iconBg)}>
                          <Icon className={cn("w-4 h-4", row.iconColor)} />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{row.category}</p>
                          <p className="text-xs text-muted-foreground md:hidden mt-0.5">{row.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell">
                      <p className="text-xs text-muted-foreground">{row.description}</p>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="text-sm font-semibold tabular-nums">{formatUSD(row.total)}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="text-sm font-medium tabular-nums text-success">{formatUSD(row.paid)}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {row.pending > 0 ? (
                        <span className="text-sm font-medium tabular-nums text-warning">{formatUSD(row.pending)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-primary/20 bg-primary/5">
                <td className="px-5 py-4" colSpan={2}>
                  <p className="text-sm font-bold">Total Revenue</p>
                </td>
                <td className="px-5 py-4 text-right">
                  <span className="text-base font-bold tabular-nums">{formatUSD(totalRevenueUSD)}</span>
                </td>
                <td className="px-5 py-4 text-right">
                  <span className="text-sm font-bold tabular-nums text-success">
                    {formatUSD(shippingRevenue + confirmationStats.totalRevenue + codStats.codFees + sourcingStats.paidProfit)}
                  </span>
                </td>
                <td className="px-5 py-4 text-right">
                  {sourcingStats.unpaidProfit > 0 ? (
                    <span className="text-sm font-bold tabular-nums text-warning">{formatUSD(sourcingStats.unpaidProfit)}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {profitBySeller.length > 0 && (
          <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '160ms' }}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Revenue by Seller</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={profitBySeller} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatUSD(v)} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={110} />
                <Tooltip formatter={(v: number, name: string) => [formatUSD(v), name]} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
                <Bar dataKey="shipping" stackId="a" name="Shipping" fill="hsl(var(--primary))" />
                <Bar dataKey="confirmation" stackId="a" name="Call Center" fill="hsl(210, 60%, 52%)" />
                <Bar dataKey="cod" stackId="a" name="COD Fees" fill="hsl(38, 90%, 55%)" />
                <Bar dataKey="sourcing" stackId="a" name="Sourcing" fill="hsl(155, 50%, 42%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 flex flex-wrap gap-4 text-xs">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(var(--primary))' }} /> Shipping</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(210, 60%, 52%)' }} /> Call Center</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(38, 90%, 55%)' }} /> COD Fees</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(155, 50%, 42%)' }} /> Sourcing</div>
            </div>
          </div>
        )}
        <ProductRevenueChart data={profitByProduct} chartColors={chartColors} />
      </div>
    </div>
  );
}

function ProductRevenueChart({ data, chartColors }: { data: { name: string; revenue: number; count: number }[]; chartColors: string[] }) {
  const [showAll, setShowAll] = useState(false);
  const visibleData = showAll ? data : data.slice(0, 6);
  const hasMore = data.length > 6;

  if (data.length === 0) {
    return (
      <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '150ms' }}>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Top Revenue by Product</h2>
        <p className="text-muted-foreground text-sm text-center py-10">No delivered orders yet</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '150ms' }}>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Top Revenue by Product</h2>
      <ResponsiveContainer width="100%" height={visibleData.length * 44 + 30}>
        <BarChart data={visibleData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatUSD(pkrToUsd(v))} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={120} />
          <Tooltip formatter={(v: number) => formatUSD(pkrToUsd(v))} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
          <Bar dataKey="revenue" radius={[0, 4, 4, 0]} name="Revenue ($)">
            {visibleData.map((_, i) => (
              <Cell key={i} fill={chartColors[i % chartColors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {hasMore && (
        <Button variant="ghost" size="sm" className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAll(!showAll)}>
          <ChevronDown className={cn("w-3.5 h-3.5 mr-1 transition-transform", showAll && "rotate-180")} />
          {showAll ? "Show less" : `Show ${data.length - 6} more products`}
        </Button>
      )}
    </div>
  );
}
