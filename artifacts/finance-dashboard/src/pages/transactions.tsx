import { useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, Transaction } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ArrowDownRight, ArrowUpRight, DollarSign, Receipt, Wallet } from "lucide-react";

export default function Transactions() {
  const [filterType, setFilterType] = useState<string>("all");
  
  const { data: transactions = [], isLoading } = useQuery({ 
    queryKey: ["transactions"], 
    queryFn: api.getTransactions 
  });

  const filteredData = filterType === "all" 
    ? transactions 
    : transactions.filter(t => t.type === filterType);

  const getIconForType = (type: string) => {
    switch(type) {
      case 'fund': return <Wallet className="w-4 h-4 text-primary" />;
      case 'salary': return <DollarSign className="w-4 h-4 text-orange-500" />;
      case 'expense': return <Receipt className="w-4 h-4 text-destructive" />;
      default: return <Receipt className="w-4 h-4" />;
    }
  };

  const getBadgeForType = (type: string, category: string) => {
    let classes = "";
    switch(type) {
      case 'fund': classes = "bg-primary/10 text-primary border-primary/20"; break;
      case 'salary': classes = "bg-orange-500/10 text-orange-500 border-orange-500/20"; break;
      case 'expense': classes = "bg-destructive/10 text-destructive border-destructive/20"; break;
      default: classes = "bg-secondary text-secondary-foreground";
    }
    return <Badge variant="outline" className={`font-normal ${classes}`}>{category}</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Master Ledger</h1>
            <p className="text-muted-foreground text-sm mt-1">Complete chronological record of all financial movements.</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Filter:</span>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[180px] bg-card">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Movements</SelectItem>
                <SelectItem value="fund">Inflows (Funds)</SelectItem>
                <SelectItem value="expense">Outflows (Expenses)</SelectItem>
                <SelectItem value="salary">Outflows (Payroll)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card className="border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 bg-secondary/20 hover:bg-secondary/20">
                <TableHead>Record</TableHead>
                <TableHead>Type & Category</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead className="text-right">Net Effect</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading ledger...</TableCell></TableRow>
              ) : filteredData.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No records found matching filter.</TableCell></TableRow>
              ) : (
                filteredData.map((tx) => (
                  <TableRow key={tx.id} className="border-border/50 hover:bg-secondary/10 transition-colors">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-card border border-border shadow-sm">
                          {getIconForType(tx.type)}
                        </div>
                        <span className="text-foreground">{tx.description}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getBadgeForType(tx.type, tx.category)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm font-mono tracking-tight">
                      {format(new Date(tx.date), "MMM dd, yyyy — HH:mm")}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <div className="flex items-center justify-end gap-2">
                        {tx.amount > 0 ? (
                          <span className="text-primary flex items-center">
                            +{tx.amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                          </span>
                        ) : (
                          <span className="text-foreground flex items-center">
                            {tx.amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </DashboardLayout>
  );
}
