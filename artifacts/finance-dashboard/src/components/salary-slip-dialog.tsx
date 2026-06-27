import { Plus, Trash2 } from "lucide-react";
import type { SalarySlipDraft, SalarySlipLineItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

type Props = {
  open: boolean;
  draft: SalarySlipDraft | null;
  expectedNet: number;
  isConfirming: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (draft: SalarySlipDraft) => void;
  onConfirm: () => void;
};

function money(value: number) {
  return value.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

function numericValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function recalculate(draft: SalarySlipDraft, patch: Partial<SalarySlipDraft> = {}) {
  const next = { ...draft, ...patch };
  const totalEarnings = next.earnings.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalDeductions = next.deductions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return {
    ...next,
    grossWages: totalEarnings,
    totalEarnings,
    totalDeductions,
    netSalary: totalEarnings - totalDeductions,
  };
}

function TextField(props: {
  label: string;
  value: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{props.label}</Label>
      <Input
        type={props.type}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="h-9"
      />
    </div>
  );
}

function NumberField(props: { label: string; value: number; readOnly?: boolean; onChange: (value: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{props.label}</Label>
      <Input
        type="number"
        min="0"
        step="1"
        value={props.value}
        onChange={(event) => props.onChange(numericValue(event.target.value))}
        readOnly={props.readOnly}
        className={props.readOnly ? "h-9 bg-muted/40" : "h-9"}
      />
    </div>
  );
}

function LineItems(props: {
  title: string;
  items: SalarySlipLineItem[];
  onChange: (items: SalarySlipLineItem[]) => void;
}) {
  const updateItem = (index: number, patch: Partial<SalarySlipLineItem>) => {
    props.onChange(props.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  return (
    <section className="border border-border">
      <div className="flex h-10 items-center justify-between border-b border-border bg-muted/40 px-3">
        <h3 className="text-sm font-semibold">{props.title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={`Add ${props.title.toLowerCase()} item`}
          onClick={() => props.onChange([...props.items, { label: "", amount: 0 }])}
          disabled={props.items.length >= 8}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="divide-y divide-border">
        {props.items.map((item, index) => (
          <div key={`${props.title}-${index}`} className="grid grid-cols-[1fr_120px_34px] gap-2 p-2">
            <Input
              aria-label={`${props.title} label`}
              value={item.label}
              onChange={(event) => updateItem(index, { label: event.target.value })}
              className="h-8"
            />
            <Input
              aria-label={`${props.title} amount`}
              type="number"
              min="0"
              step="1"
              value={item.amount}
              onChange={(event) => updateItem(index, { amount: numericValue(event.target.value) })}
              className="h-8 text-right"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              title={`Remove ${item.label || "item"}`}
              onClick={() => props.onChange(props.items.filter((_, itemIndex) => itemIndex !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SalarySlipDialog({
  open,
  draft,
  expectedNet,
  isConfirming,
  onOpenChange,
  onChange,
  onConfirm,
}: Props) {
  if (!draft) return null;

  const update = (patch: Partial<SalarySlipDraft>) => onChange(recalculate(draft, patch));
  const reconciles = draft.netSalary === expectedNet;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Review salary slip</DialogTitle>
          <DialogDescription>Edit the slip details, then confirm the payment and PDF delivery.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(92vh-150px)]">
          <div className="space-y-5 p-6">
            <div className="border border-border bg-background">
              <div className="grid gap-4 border-b border-border p-5 md:grid-cols-[1.2fr_1fr]">
                <div className="space-y-3">
                  <TextField label="Company name" value={draft.companyName} onChange={(companyName) => update({ companyName })} />
                  <TextField label="Company address" value={draft.companyAddress} onChange={(companyAddress) => update({ companyAddress })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <TextField label="Pay period" value={draft.payPeriod} onChange={(payPeriod) => update({ payPeriod })} />
                  <TextField label="Payment date" type="date" value={draft.paymentDate} onChange={(paymentDate) => update({ paymentDate })} />
                </div>
              </div>

              <div className="grid gap-3 border-b border-border p-5 sm:grid-cols-2 lg:grid-cols-3">
                <TextField label="Employee ID" value={draft.employeeId} onChange={(employeeId) => update({ employeeId })} />
                <TextField label="Employee name" value={draft.employeeName} onChange={(employeeName) => update({ employeeName })} />
                <TextField label="Designation" value={draft.designation} onChange={(designation) => update({ designation })} />
                <TextField label="Department" value={draft.department} onChange={(department) => update({ department })} />
                <TextField label="Date of joining" type="date" value={draft.joiningDate} onChange={(joiningDate) => update({ joiningDate })} />
                <TextField label="Bank" value={draft.bankName} onChange={(bankName) => update({ bankName })} />
                <TextField label="Account number" value={draft.bankAccountNumber} onChange={(bankAccountNumber) => update({ bankAccountNumber })} />
                <TextField label="UAN" value={draft.uan} onChange={(uan) => update({ uan })} />
                <TextField label="PF number" value={draft.pfNumber} onChange={(pfNumber) => update({ pfNumber })} />
                <TextField label="ESI number" value={draft.esiNumber} onChange={(esiNumber) => update({ esiNumber })} />
              </div>

              <div className="grid gap-3 border-b border-border p-5 sm:grid-cols-2 lg:grid-cols-5">
                <NumberField label="Working days" value={draft.totalWorkingDays} onChange={(totalWorkingDays) => update({ totalWorkingDays })} />
                <NumberField label="Leave days" value={draft.leaveDays} onChange={(leaveDays) => update({ leaveDays })} />
                <NumberField label="LOP days" value={draft.lopDays} onChange={(lopDays) => update({ lopDays })} />
                <NumberField label="Paid days" value={draft.paidDays} onChange={(paidDays) => update({ paidDays })} />
                <NumberField label="Gross wages" value={draft.grossWages} readOnly onChange={() => undefined} />
              </div>

              <div className="grid md:grid-cols-2">
                <LineItems title="Earnings" items={draft.earnings} onChange={(earnings) => update({ earnings })} />
                <LineItems title="Deductions" items={draft.deductions} onChange={(deductions) => update({ deductions })} />
              </div>

              <div className="grid gap-3 border-t border-border bg-muted/30 p-5 text-sm sm:grid-cols-3">
                <div><span className="text-muted-foreground">Total earnings</span><div className="mt-1 font-semibold">{money(draft.totalEarnings)}</div></div>
                <div><span className="text-muted-foreground">Total deductions</span><div className="mt-1 font-semibold">{money(draft.totalDeductions)}</div></div>
                <div><span className="text-muted-foreground">Net salary</span><div className="mt-1 text-lg font-bold">{money(draft.netSalary)}</div></div>
              </div>
            </div>

            <TextField label="Payment note" value={draft.note} onChange={(note) => update({ note })} />
            {!reconciles ? (
              <p className="text-sm font-medium text-destructive">
                Net salary must equal the approved payroll amount of {money(expectedNet)} before payment can be confirmed.
              </p>
            ) : null}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isConfirming}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isConfirming || !reconciles}>
            {isConfirming ? "Paying and generating PDF..." : `Confirm and pay ${money(draft.netSalary)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
