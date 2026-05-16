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
  const preApprovalCode = `PA-${preApproval.id.slice(0, 8).toUpperCase()}`;
  const documentTitle = `Pre Approval Man Hour For ${preApproval.project || preApproval.clientNameSnapshot || preApproval.title}`.trim();
  const companyDisplayName = (company.companyName || "REFORIX ENGINEERING SERVICES").toUpperCase();
  const footerAddress = company.address?.trim() || "Vastu Anand, Building No. 16, Parsik Nagar, Thane, Maharashtra, India";
  const footerWebsite = company.website?.trim() || "www.reforix.com";

  const rows = preApproval.tasks
    .map(
      (task, index) => `
        <tr>
          <td class="center row-index">${index + 1}</td>
          <td>
            <div class="task-name">${escapeHtml(task.taskName)}</div>
            ${
              task.description
                ? `<div class="task-description">${escapeHtml(task.description)}</div>`
                : `<div class="task-description muted">No additional description provided.</div>`
            }
          </td>
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
              <div class="comment-header">
                <strong>${escapeHtml(comment.authorName)}</strong>
                <span>${escapeHtml(comment.authorRole)} · ${formatDate(comment.createdAt)}</span>
              </div>
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
            margin: 12mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            background: #edf1f7;
            color: #172033;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 11px;
            line-height: 1.35;
          }

          .page {
            width: 186mm;
            min-height: 273mm;
            margin: 0 auto;
          }

          .muted {
            color: #617086;
          }

          .print-actions {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            margin: 0 auto 18px;
            border: 1px solid #dce3ee;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.92);
            padding: 12px 14px;
            box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
          }

          .print-actions p {
            margin: 0;
            color: #5d6b80;
            font-size: 12px;
          }

          .print-actions button {
            border: 1px solid #122033;
            border-radius: 10px;
            background: #122033;
            color: #ffffff;
            cursor: pointer;
            font-weight: 700;
            padding: 9px 16px;
          }

          .sheet {
            overflow: hidden;
            border: 1px solid #d7deea;
            border-radius: 8px;
            background: #ffffff;
            box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
          }

          .doc-ribbon {
            position: relative;
            height: 28px;
            background: #7388b9;
          }

          .doc-ribbon::after {
            content: "";
            position: absolute;
            top: -10px;
            right: 28%;
            width: 12px;
            height: 52px;
            background: #ffffff;
            transform: rotate(24deg);
          }

          .doc-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 18px;
            padding: 16px 20px 8px;
            border-bottom: 2px solid #909090;
            background: #ffffff;
          }

          .brand-lockup {
            display: flex;
            align-items: center;
            gap: 18px;
            min-width: 0;
            flex: 1;
          }

          .brand-logo {
            margin: 0;
            color: #111111;
            font-size: 26px;
            font-weight: 800;
            line-height: 1.1;
            letter-spacing: -0.04em;
          }

          .brand-mark {
            font-size: 10px;
            vertical-align: top;
          }

          .brand-divider {
            width: 1px;
            align-self: stretch;
            background: #d9dfe8;
          }

          .brand-title {
            color: #1a1a1a;
            font-size: 21px;
            font-weight: 700;
            line-height: 1.2;
          }

          .doc-meta {
            min-width: 240px;
            color: #252525;
            font-size: 11px;
            line-height: 1.6;
          }

          .doc-meta-row {
            display: grid;
            grid-template-columns: 74px 10px 1fr;
            gap: 6px;
            align-items: baseline;
          }

          .doc-meta-label,
          .doc-meta-separator,
          .doc-meta-value {
            margin: 0;
            color: #252525;
            font-size: 11px;
          }

          .doc-meta-label {
            font-weight: 400;
          }

          .doc-title-row {
            padding: 12px 20px 14px;
            border-bottom: 1px solid #d6dce5;
          }

          .doc-title-row h1 {
            margin: 0;
            color: #202020;
            font-size: 18px;
            font-weight: 500;
            line-height: 1.2;
          }

          .sheet-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
            padding: 14px 16px 0;
          }

          .sheet-body {
            padding: 0 16px 14px;
          }

          .info-card {
            border: 1px solid #dce3ee;
            border-radius: 10px;
            background: #fbfdff;
            padding: 11px 13px;
          }

          .section-title {
            margin: 0 0 10px;
            color: #728196;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }

          .company-line {
            margin: 0 0 4px;
          }

          .company-line strong {
            color: #122033;
            font-size: 13px;
          }

          .summary-card,
          .notes-card,
          .conversation-card,
          .table-card {
            margin-top: 12px;
            border: 1px solid #dce3ee;
            border-radius: 10px;
            background: #ffffff;
            overflow: hidden;
          }

          .summary-header,
          .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 10px 14px;
            border-bottom: 1px solid #e7edf5;
            background: #f8fbff;
          }

          .summary-header p,
          .card-header p {
            margin: 0;
            color: #728196;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }

          .summary-table,
          table {
            width: 100%;
            border-collapse: collapse;
          }

          .summary-table td {
            border-top: 1px solid #edf2f8;
            padding: 7px 12px;
            vertical-align: top;
          }

          .summary-table tr:first-child td {
            border-top: 0;
          }

          .summary-table td:first-child {
            width: 32%;
            color: #304156;
            font-weight: 700;
          }

          .work-description {
            min-height: 54px;
            color: #172033;
          }

          th,
          td {
            border-top: 1px solid #edf2f8;
            padding: 7px 9px;
            vertical-align: top;
          }

          th {
            border-top: 0;
            background: #f8fbff;
            color: #64748b;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-align: center;
            text-transform: uppercase;
          }

          .center {
            text-align: center;
          }

          .right {
            text-align: right;
          }

          .row-index {
            color: #64748b;
            font-weight: 700;
          }

          .task-name {
            color: #172033;
            font-size: 11px;
            font-weight: 700;
          }

          .task-description {
            margin-top: 4px;
            color: #5f6f86;
            font-size: 10px;
            line-height: 1.35;
          }

          .total-row td {
            background: #f8fbff;
            font-weight: 800;
          }

          .notes-body,
          .conversation-body {
            padding: 11px 13px 13px;
          }

          .notes-body p {
            margin: 0;
            color: #2d3b50;
          }

          .comment {
            margin-top: 10px;
            border-top: 1px solid #e8eef6;
            padding-top: 10px;
          }

          .comment:first-child {
            margin-top: 0;
            border-top: 0;
            padding-top: 0;
          }

          .comment-header {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
          }

          .comment strong {
            color: #172033;
          }

          .comment span {
            color: #738197;
            font-size: 10px;
            text-transform: capitalize;
          }

          .comment p {
            margin: 6px 0 0;
            color: #334155;
          }

          .billing-summary {
            margin-top: 10px;
            padding: 0 4px;
            color: #526175;
            font-size: 9px;
          }

          .footer-band {
            position: relative;
            margin-top: 12px;
            background: #7388b9;
            color: #ffffff;
            text-align: center;
            padding: 8px 20px 10px;
          }

          .footer-band::before {
            content: "";
            position: absolute;
            top: -8px;
            left: 20%;
            width: 12px;
            height: 52px;
            background: #ffffff;
            transform: rotate(28deg);
          }

          .footer-company {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
          }

          .footer-address,
          .footer-website {
            font-size: 9px;
            font-weight: 600;
          }

          @media screen {
            .page {
              padding: 8px 0 20px;
            }
          }

          @media print {
            body {
              background: #ffffff;
            }

            .page {
              max-width: none;
            }

            .print-actions {
              display: none;
            }

            .sheet {
              box-shadow: none;
              border-radius: 0;
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
            <div class="doc-ribbon"></div>
            <div class="doc-header">
              <div class="brand-lockup">
                <p class="brand-logo">REFORIX<span class="brand-mark">™</span></p>
                <div class="brand-divider"></div>
                <div class="brand-title">${escapeHtml(companyDisplayName)}</div>
              </div>
              <div class="doc-meta">
                <div class="doc-meta-row">
                  <p class="doc-meta-label">Doc No</p>
                  <p class="doc-meta-separator">:</p>
                  <p class="doc-meta-value">${escapeHtml(preApprovalCode)}</p>
                </div>
                <div class="doc-meta-row">
                  <p class="doc-meta-label">Date</p>
                  <p class="doc-meta-separator">:</p>
                  <p class="doc-meta-value">${formatShortDate(preApproval.date)}</p>
                </div>
                <div class="doc-meta-row">
                  <p class="doc-meta-label">Revision</p>
                  <p class="doc-meta-separator">:</p>
                  <p class="doc-meta-value">00</p>
                </div>
              </div>
            </div>
            <div class="doc-title-row">
              <h1>${escapeHtml(documentTitle)}</h1>
            </div>

            <div class="sheet-grid">
              <div class="info-card">
                <p class="section-title">Company Information</p>
                <p class="company-line"><strong>${escapeHtml(company.companyName || "Reforix Payroll")}</strong></p>
                <p class="company-line">${escapeHtml(company.address || "Address")}</p>
                <p class="company-line">Phone: ${escapeHtml(company.phone || "-")}</p>
                <p class="company-line">Email: ${escapeHtml(company.email || "-")}</p>
                <p class="company-line">Website: ${escapeHtml(company.website || "-")}</p>
              </div>
              <div class="info-card">
                <p class="section-title">Client Information</p>
                <p class="company-line"><strong>${escapeHtml(client.companyName || preApproval.clientNameSnapshot)}</strong></p>
                <p class="company-line">${escapeHtml(client.address || "Address")}</p>
                <p class="company-line">Phone: ${escapeHtml(client.phone || "-")}</p>
                <p class="company-line">Email: ${escapeHtml(client.email || "-")}</p>
                <p class="company-line">Website: ${escapeHtml(client.website || "-")}</p>
              </div>
            </div>

            <div class="sheet-body">
              <div class="summary-card">
                <div class="summary-header">
                  <p>Project Summary</p>
                </div>
                <table class="summary-table">
                  <tr><td>Bill date</td><td>${formatShortDate(preApproval.date)}</td></tr>
                  <tr><td>From</td><td>${escapeHtml(company.companyName || "Reforix Payroll")}</td></tr>
                  <tr><td>To</td><td>${escapeHtml(client.companyName || preApproval.clientNameSnapshot)}</td></tr>
                  <tr><td>Project</td><td>${escapeHtml(preApproval.project)}</td></tr>
                  <tr><td>Project start date</td><td>${formatDate(project.projectStartDate)}</td></tr>
                  <tr><td>Project completion date</td><td>${formatDate(project.projectCompletionDate)}</td></tr>
                  <tr><td>Total contract value</td><td>${formatCurrency(Number(project.totalContractValue ?? 0))}</td></tr>
                  <tr><td>Percentage of retainage held (%)</td><td>${Number(project.retainagePercent ?? 0).toFixed(2)}%</td></tr>
                  <tr><td>Total retainage amount held</td><td>${formatCurrency(Number(project.retainageAmount ?? 0))}</td></tr>
                  <tr><td>Work Description</td><td class="work-description">${escapeHtml(project.workDescription || preApproval.title)}</td></tr>
                </table>
              </div>

              <div class="table-card">
                <div class="card-header">
                  <p>Line Items</p>
                </div>
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
              </div>

              <div class="notes-card">
                <div class="card-header">
                  <p>Note</p>
                </div>
                <div class="notes-body">
                  <p>${escapeHtml(preApproval.notes || "No additional notes added.")}</p>
                </div>
              </div>

              <div class="conversation-card">
                <div class="card-header">
                  <p>Client / Admin Conversation</p>
                </div>
                <div class="conversation-body">
                  ${comments}
                </div>
              </div>

              <div class="billing-summary">
                Progress billing summary: Amount previously billed ${formatCurrency(previouslyBilled)}. Current amount ${formatCurrency(currentAmount)}. Total ${formatCurrency(totalBilled)}.
              </div>

              <div class="footer-band">
                <div class="footer-company">${escapeHtml(companyDisplayName)}</div>
                <div class="footer-address">${escapeHtml(footerAddress)}</div>
                <div class="footer-website">${escapeHtml(footerWebsite)}</div>
              </div>
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
