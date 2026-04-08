import type { PreApproval } from "@/lib/api";

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value?: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatShortDate(value?: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function statusLabel(status: PreApproval["status"]) {
  return status === "changes_requested" ? "Changes Requested" : status.replace("_", " ");
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function exportPreApprovalPdf(preApproval: PreApproval) {
  const company = preApproval.companyInfo ?? {};
  const client = preApproval.clientInfo ?? {};
  const project = preApproval.projectInfo ?? {};
  const previouslyBilled = Math.max(0, Number(project.previouslyBilledAmount ?? 0));
  const currentAmount = Math.max(0, Number(preApproval.totalAmount ?? 0));
  const totalBilled = previouslyBilled + currentAmount;
  const rows = preApproval.tasks
    .map(
      (task, index) => `
        <tr>
          <td class="center">${index + 1}</td>
          <td><strong>${escapeHtml(task.taskName)}</strong>${task.description ? `<br />${escapeHtml(task.description)}` : ""}</td>
          <td class="right">${formatCurrency(task.rate)}</td>
          <td class="center">100%</td>
          <td class="right">${task.hours.toFixed(2)}</td>
          <td class="right">${formatCurrency(task.amount)}</td>
          <td class="right">${formatCurrency(0)}</td>
          <td class="right">${formatCurrency(task.amount)}</td>
        </tr>
      `,
    )
    .join("");

  const comments = preApproval.comments.length
    ? preApproval.comments
        .map(
          (comment) => `
            <div class="comment">
              <strong>${escapeHtml(comment.authorName)}</strong>
              <span>${escapeHtml(comment.authorRole)} - ${formatDate(comment.createdAt)}</span>
              <p>${escapeHtml(comment.message)}</p>
            </div>
          `,
        )
        .join("")
    : `<p class="muted">No client/admin comments recorded.</p>`;

  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(preApproval.title)} - Pre Approval</title>
        <style>
          @page {
            size: A4;
            margin: 16mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            background: #ffffff;
            color: #111111;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 10px;
            line-height: 1.25;
          }

          .page {
            max-width: 980px;
            margin: 0 auto;
          }

          .muted {
            color: #4b5563;
          }

          .sheet {
            border: 1px solid #111111;
          }

          .sheet-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }

          .cell {
            border-right: 1px solid #111111;
            border-bottom: 1px solid #111111;
            min-height: 20px;
            padding: 5px 7px;
          }

          .cell:nth-child(2n) {
            border-right: 0;
          }

          .section-title {
            background: #f1f3f5;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-align: center;
            text-transform: uppercase;
          }

          .company-line {
            margin: 1px 0;
          }

          .project-table {
            width: 100%;
            margin: 0;
            border-collapse: collapse;
          }

          .project-table td {
            border: 1px solid #111111;
            padding: 5px 7px;
          }

          .project-table td:first-child {
            width: 32%;
            font-weight: 700;
          }

          .work-description {
            min-height: 54px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
          }

          th,
          td {
            border: 1px solid #111111;
            padding: 5px 6px;
            vertical-align: top;
          }

          th {
            background: #f1f3f5;
            color: #111111;
            font-size: 9px;
            font-weight: 700;
            text-align: center;
            text-transform: uppercase;
          }

          .center {
            text-align: center;
          }

          .right {
            text-align: right;
          }

          .total-row td {
            background: #f8fafc;
            font-weight: 800;
          }

          .notes {
            border-top: 0;
            padding: 8px;
          }

          .comment {
            margin-top: 8px;
            border-top: 1px solid #e5e7eb;
            padding-top: 8px;
          }

          .comment:first-child {
            border-top: 0;
            padding-top: 0;
          }

          .comment span {
            margin-left: 8px;
            color: #626b77;
            font-size: 11px;
            text-transform: capitalize;
          }

          .footer {
            border-top: 1px solid #111111;
            padding: 8px;
            color: #4b5563;
            font-size: 9px;
          }

          .print-actions {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 14px;
            border: 1px solid #d8dde3;
            border-radius: 12px;
            background: #f8fafc;
            padding: 10px 12px;
          }

          .print-actions p {
            margin: 0;
            color: #4b5563;
            font-size: 11px;
          }

          .print-actions button {
            border: 1px solid #111827;
            border-radius: 8px;
            background: #111827;
            color: #ffffff;
            cursor: pointer;
            padding: 8px 14px;
          }

          @media print {
            .print-actions {
              display: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="print-actions">
            <p>Preview this quotation, then use the button to save it as a PDF.</p>
            <button onclick="window.print()">Save / Print PDF</button>
          </div>

          <div class="sheet">
            <div class="sheet-grid">
              <div class="cell section-title">Company Information</div>
              <div class="cell section-title">Client Information</div>
              <div class="cell">
                <p class="company-line"><strong>${escapeHtml(company.companyName || "Yojak")}</strong></p>
                <p class="company-line">${escapeHtml(company.address || "Address")}</p>
                <p class="company-line">Phone ${escapeHtml(company.phone || "-")}</p>
                <p class="company-line">Email ${escapeHtml(company.email || "-")}</p>
                <p class="company-line">Website ${escapeHtml(company.website || "-")}</p>
              </div>
              <div class="cell">
                <p class="company-line"><strong>${escapeHtml(client.companyName || preApproval.clientNameSnapshot)}</strong></p>
                <p class="company-line">${escapeHtml(client.address || "Address")}</p>
                <p class="company-line">Phone ${escapeHtml(client.phone || "-")}</p>
                <p class="company-line">Email ${escapeHtml(client.email || "-")}</p>
                <p class="company-line">Website ${escapeHtml(client.website || "-")}</p>
              </div>
            </div>

            <table class="project-table">
              <tr><td colspan="2" class="section-title">Project Summary</td></tr>
              <tr><td>Bill date</td><td>${formatShortDate(preApproval.date)}</td></tr>
              <tr><td>From</td><td>${escapeHtml(company.companyName || "Yojak")}</td></tr>
              <tr><td>To</td><td>${escapeHtml(client.companyName || preApproval.clientNameSnapshot)}</td></tr>
              <tr><td>Project</td><td>${escapeHtml(preApproval.project)}</td></tr>
              <tr><td>Project start date</td><td>${formatDate(project.projectStartDate)}</td></tr>
              <tr><td>Project completion date</td><td>${formatDate(project.projectCompletionDate)}</td></tr>
              <tr><td>Total contract value</td><td>${formatCurrency(Number(project.totalContractValue ?? 0))}</td></tr>
              <tr><td>Percentage of retainage held (%)</td><td>${Number(project.retainagePercent ?? 0).toFixed(2)}%</td></tr>
              <tr><td>Total retainage amount held</td><td>${formatCurrency(Number(project.retainageAmount ?? 0))}</td></tr>
              <tr><td>Work Description</td><td class="work-description">${escapeHtml(project.workDescription || preApproval.title)}</td></tr>
            </table>

          <table>
            <thead>
              <tr>
                <th class="center">Line item #</th>
                <th>Description of work</th>
                <th class="right">Per Hour Cost</th>
                <th class="center">% Complete</th>
                <th class="right">Hours</th>
                <th class="right">Total Value</th>
                <th class="right">Amount previously billed</th>
                <th class="right">Current amount</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
              <tr class="total-row">
                <td colspan="3" class="right">Total</td>
                <td></td>
                <td class="right">${preApproval.totalHours.toFixed(2)}</td>
                <td class="right">${formatCurrency(preApproval.totalAmount)}</td>
                <td class="right">${formatCurrency(previouslyBilled)}</td>
                <td class="right">${formatCurrency(currentAmount)}</td>
              </tr>
            </tbody>
          </table>

          <div class="notes">
            <strong>Note</strong>
            <p>${escapeHtml(preApproval.notes || "No additional notes added.")}</p>
          </div>

          <div class="notes">
            <strong>Client / Admin Conversation</strong>
            ${comments}
          </div>

          <div class="footer">
            Progress billing summary: Amount previously billed ${formatCurrency(previouslyBilled)}. Current amount ${formatCurrency(currentAmount)}. Total ${formatCurrency(totalBilled)}.
          </div>
        </div>
        </div>

      </body>
    </html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, "_blank");

  if (!popup) {
    URL.revokeObjectURL(url);
    return;
  }

  popup.focus();

  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
