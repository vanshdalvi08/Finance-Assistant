import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Landmark, PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { MetricCard } from "@/components/app/metric-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { yojakData } from "@/lib/yojak-data";

export default function AdminFundsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    source: "",
    sourceType: "revenue" as const,
    amount: 0,
    date: new Date().toISOString().slice(0, 10),
    note: "",
  });
  const { data: funds = [] } = useQuery({ queryKey: ["yojak-funds"], queryFn: yojakData.getFunds });
  const { data: series = [] } = useQuery({ queryKey: ["yojak-finance-series"], queryFn: yojakData.getFinanceChartSeries });
  const { data: overview } = useQuery({ queryKey: ["yojak-admin-overview"], queryFn: yojakData.getAdminOverview });

  const mutation = useMutation({
    mutationFn: yojakData.addFund,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["yojak-funds"] });
      queryClient.invalidateQueries({ queryKey: ["yojak-finance-series"] });
      queryClient.invalidateQueries({ queryKey: ["yojak-admin-overview"] });
      queryClient.invalidateQueries({ queryKey: ["yojak-transactions"] });
      setOpen(false);
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Treasury"
        title="Funds and capital inflow"
        description="Track revenue, investment tranches, grants, and bridge inflows against current balance."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><PlusCircle className="mr-2 h-4 w-4" />Add fund</Button>
            </DialogTrigger>
            <DialogContent className="border-white/8 bg-[#111010]">
              <DialogHeader><DialogTitle>Record capital inflow</DialogTitle></DialogHeader>
              <div className="grid gap-4">
                <Input placeholder="Source" value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))} />
                <Select value={form.sourceType} onValueChange={(value) => setForm((current) => ({ ...current, sourceType: value as typeof form.sourceType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="revenue">Revenue</SelectItem>
                    <SelectItem value="investment">Investment</SelectItem>
                    <SelectItem value="grant">Grant</SelectItem>
                    <SelectItem value="bridge">Bridge</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" placeholder="Amount" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: Number(event.target.value) }))} />
                <Input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
                <Input placeholder="Note" value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
                <Button onClick={() => mutation.mutate(form)} disabled={!form.source || !form.amount}>Save fund entry</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <MetricCard label="Total inflow" value={formatCurrency(overview?.totalFunds ?? 0)} icon={<Landmark className="h-5 w-5" />} />
        <MetricCard label="Current balance" value={formatCurrency(overview?.currentBalance ?? 0)} />
        <MetricCard label="MTD funds" value={formatCurrency(overview?.monthToDateFunds ?? 0)} />
      </div>

      <Card className="border-white/8 bg-white/[0.03]">
        <CardContent className="h-[320px] pt-6">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <defs>
                <linearGradient id="capital" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#d8b26a" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#d8b26a" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="month" stroke="rgba(201,197,190,0.7)" />
              <YAxis stroke="rgba(201,197,190,0.7)" tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
              <Tooltip contentStyle={{ backgroundColor: "rgba(15,14,14,0.96)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18 }} />
              <Area dataKey="funds" stroke="#d8b26a" fill="url(#capital)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-white/8 bg-white/[0.03]">
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {funds.map((fund) => (
                <TableRow key={fund.id}>
                  <TableCell>{fund.source}</TableCell>
                  <TableCell className="capitalize">{fund.sourceType}</TableCell>
                  <TableCell>{new Date(fund.date).toLocaleDateString()}</TableCell>
                  <TableCell>{fund.note || "-"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(fund.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
