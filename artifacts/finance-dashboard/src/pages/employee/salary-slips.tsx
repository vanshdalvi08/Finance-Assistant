import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

function dateLabel(date: string) {
  return new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function EmployeeSalarySlipsPage() {
  const [downloadingSlipId, setDownloadingSlipId] = useState<string | null>(null);
  const { data: slips = [], isLoading } = useQuery({
    queryKey: ["salary-slips", "self"],
    queryFn: () => api.getSalarySlips(),
  });

  const ordered = useMemo(
    () => [...slips].sort((left, right) => new Date(right.paymentDate).getTime() - new Date(left.paymentDate).getTime()),
    [slips],
  );
  const totalPaid = ordered.reduce((sum, slip) => sum + slip.netAmount, 0);
  const latest = ordered[0];

  async function openSalarySlip(slip: (typeof ordered)[number], mode: "view" | "print" = "view") {
    if (!slip.downloadUrl) {
      return;
    }

    if (!slip.downloadUrl.includes("/api/")) {
      window.open(slip.downloadUrl, "_blank", "noopener,noreferrer");
      return;
    }

    setDownloadingSlipId(slip.id);
    try {
      const blob = await api.downloadSalarySlipPdf(slip.downloadUrl);
      const objectUrl = URL.createObjectURL(blob);
      const popup = window.open(objectUrl, "_blank");
      if (popup && mode === "print") {
        popup.addEventListener("load", () => {
          popup.focus();
          popup.print();
        });
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } finally {
      setDownloadingSlipId(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Salary Slips</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your permanent payroll documents and payment history.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <DashboardCard label="Total Paid" value={formatCurrency(totalPaid)} />
          <DashboardCard label="Salary Slips" value={ordered.length.toString()} />
          <DashboardCard label="Latest Payment" value={latest ? formatCurrency(latest.netAmount) : formatCurrency(0)} />
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Salary Slip Archive</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50">
                  <TableHead>Pay period</TableHead>
                  <TableHead>Payment date</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net salary</TableHead>
                  <TableHead className="w-[70px] text-right">PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow className="border-border/50">
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Loading salary slips...</TableCell>
                  </TableRow>
                ) : ordered.length === 0 ? (
                  <TableRow className="border-border/50">
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No generated salary slips yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  ordered.map((slip) => (
                    <TableRow key={slip.id} className="border-border/50">
                      <TableCell className="font-medium">{slip.payPeriod}</TableCell>
                      <TableCell>{dateLabel(slip.paymentDate)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(slip.grossAmount)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(slip.deductionAmount)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(slip.netAmount)}</TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          {slip.downloadUrl ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Download salary slip PDF"
                                disabled={downloadingSlipId === slip.id}
                                onClick={() => void openSalarySlip(slip)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Print salary slip PDF"
                                disabled={downloadingSlipId === slip.id}
                                onClick={() => void openSalarySlip(slip, "print")}
                              >
                                <Printer className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <Button variant="ghost" size="icon" disabled title="Salary slip PDF is unavailable">
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
