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

function formatDocDateCode(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return formatDocDateCode();
  }

  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
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
  const includeGst = Boolean(project.includeGst);
  const gstAmount = includeGst ? Math.round(currentAmount * 0.18) : 0;
  const currentAmountWithGst = currentAmount + gstAmount;
  const totalBilled = previouslyBilled + currentAmountWithGst;
  const documentDate = preApproval.date || preApproval.createdAt || new Date().toISOString();
  const preApprovalCode = project.documentNumber?.trim() || `REFO-${formatDocDateCode(documentDate)}-${preApproval.id.slice(0, 4).toUpperCase()}`;
  const revision = project.revision?.trim() || "01";
  const documentTitle = preApproval.title || preApproval.project || preApproval.clientNameSnapshot || "Pre Approval";
  const configuredCompanyName = (company.companyName || "").trim();
  const companyDisplayName =
    !configuredCompanyName || configuredCompanyName.toUpperCase() === "REFORIX"
      ? "REFORIX ENGINEERING SERVICES"
      : configuredCompanyName.toUpperCase();
  const footerAddress = company.address?.trim() || "Vastu Anand, Building No. 16, Parsik Nagar, Thane, Maharashtra, India";
  const footerWebsite = company.website?.trim() || "www.reforix.com";

  const rows = preApproval.tasks
    .map(
      (task, index) => {
        const isExpense = task.lineType === "expense";
        return `
        <tr class="${isExpense ? "expense-row" : ""}">
          <td class="center row-index">${index + 1}</td>
          <td class="description-cell">
            <div class="task-name">${escapeHtml(task.taskName)}</div>
            ${isExpense ? `<div class="line-type">Direct expense</div>` : ""}
            ${
              task.description
                ? `<div class="task-description">${escapeHtml(task.description)}</div>`
                : `<div class="task-description muted">No additional description provided.</div>`
            }
          </td>
          <td class="right numeric-cell"><span>${isExpense ? "-" : formatCurrency(task.rate)}</span></td>
          <td class="center numeric-cell"><span>${isExpense ? "-" : "100%"}</span></td>
          <td class="right numeric-cell"><span>${isExpense ? "-" : task.hours.toFixed(2)}</span></td>
          <td class="right numeric-cell"><span>${formatCurrency(task.amount)}</span></td>
          <td class="right numeric-cell"><span>${formatCurrency(0)}</span></td>
          <td class="right numeric-cell"><span>${formatCurrency(task.amount)}</span></td>
        </tr>
      `;
      },
    )
    .join("");

  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Pre Approval</title>
        <style>
          @page {
            size: A4;
            margin: 0;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            background: #1f1f1f;
            color: #111111;
            font-family: "Aptos", "Segoe UI", Arial, Helvetica, sans-serif;
            font-size: 11.8px;
            line-height: 1.48;
          }

          .page {
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            background: #ffffff;
          }

          .muted {
            color: #617086;
          }

          .print-actions {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            margin: 10px auto 18px;
            border: 1px solid #dce3ee;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.92);
            padding: 12px 14px;
            box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
          }

          .print-actions p {
            margin: 0;
            color: #5d6b80;
            font-size: 11px;
          }

          .print-actions button {
            border: 1px solid #122033;
            border-radius: 10px;
            background: #122033;
            color: #ffffff;
            cursor: pointer;
            font-size: 10.5px;
            font-weight: 700;
            padding: 9px 16px;
          }

          .sheet {
            display: flex;
            min-height: 297mm;
            flex-direction: column;
            overflow: hidden;
            border: 0;
            border-radius: 0;
            background: #ffffff;
            box-shadow: none;
          }

          .doc-ribbon {
            position: relative;
            height: 5mm;
            background: #7186ba;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .doc-ribbon::after {
            content: "";
            position: absolute;
            top: -10.5mm;
            right: 58mm;
            width: 4.2mm;
            height: 25mm;
            background: #ffffff;
            transform: rotate(31deg);
            transform-origin: center;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .doc-header {
            display: grid;
            align-items: center;
            grid-template-columns: 112mm 1fr;
            gap: 5mm;
            min-height: 24mm;
            padding: 0 7mm 0 9mm;
            border-bottom: 1px solid #9d9d9d;
            background: #ffffff;
          }

          .brand-lockup {
            display: grid;
            align-items: center;
            grid-template-columns: 42mm 1px 1fr;
            gap: 5.5mm;
            min-width: 0;
            height: 15mm;
          }

          .brand-logo {
            margin: 0;
            color: #000000;
            font-family: Arial Black, Arial, Helvetica, sans-serif;
            font-size: 23px;
            font-weight: 900;
            line-height: 1;
            letter-spacing: -0.015em;
            white-space: nowrap;
            justify-self: center;
          }

          .brand-mark {
            margin-left: 1px;
            font-family: "Segoe UI", Arial, Helvetica, sans-serif;
            font-size: 6px;
            font-weight: 700;
            vertical-align: top;
          }

          .brand-divider {
            width: 1px;
            height: 16mm;
            background: #d7d7d7;
          }

          .brand-title {
            color: #000000;
            font-size: 15.5px;
            font-weight: 700;
            line-height: 1.15;
            min-width: 0;
            white-space: nowrap;
            justify-self: center;
            align-self: center;
            transform: translateY(0.4mm);
          }

          .doc-meta {
            width: 48mm;
            color: #111111;
            font-size: 10.8px;
            line-height: 1.45;
            justify-self: end;
            flex-shrink: 0;
          }

          .doc-meta-row {
            display: grid;
            grid-template-columns: 18mm 3mm minmax(0, 1fr);
            gap: 1.5mm;
            align-items: baseline;
          }

          .doc-meta-label,
          .doc-meta-separator,
          .doc-meta-value {
            margin: 0;
            color: #111111;
            font-size: 10.8px;
            font-weight: 400;
          }

          .doc-meta-label {
            font-weight: 400;
          }

          .doc-meta-separator {
            text-align: center;
          }

          .doc-meta-value {
            word-break: keep-all;
            overflow-wrap: normal;
          }

          .doc-title-row {
            padding: 2.2mm 9mm;
            border-bottom: 1px solid #9d9d9d;
          }

          .doc-title-row h1 {
            margin: 0;
            color: #111111;
            font-size: 12px;
            font-weight: 600;
            line-height: 1.3;
          }

          .content-shell {
            flex: 1;
            padding: 2.2mm 5.5mm 7mm;
          }

          .sheet-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 3mm;
          }

          .sheet-body {
            padding: 0;
          }

          .info-card {
            min-height: 24mm;
            border: 1px solid #d4d4d4;
            border-radius: 2mm;
            background: #ffffff;
            padding: 2.4mm 3.5mm;
          }

          .section-title {
            margin: 0 0 1mm;
            color: #738197;
            font-size: 7.8px;
            font-weight: 800;
            letter-spacing: 0.14em;
            text-transform: uppercase;
          }

          .company-line {
            margin: 0 0 0.7mm;
            color: #172033;
            font-size: 9.9px;
            line-height: 1.22;
          }

          .company-line strong {
            color: #111111;
            font-size: 11px;
            font-weight: 800;
          }

          .party-details {
            display: grid;
            gap: 0.45mm;
            margin-top: 0.9mm;
          }

          .party-row {
            display: grid;
            grid-template-columns: 17mm 3.5mm minmax(0, 1fr);
            column-gap: 1.2mm;
            align-items: start;
            color: #172033;
            font-size: 9.5px;
            line-height: 1.2;
          }

          .party-label {
            white-space: nowrap;
          }

          .party-separator {
            text-align: center;
            white-space: nowrap;
          }

          .party-value {
            min-width: 0;
            overflow-wrap: anywhere;
          }

          .summary-card,
          .notes-card,
          .table-card {
            margin-top: 1.8mm;
            border: 1px solid #dce3ee;
            border-radius: 2mm;
            background: #ffffff;
            overflow: hidden;
          }

          .summary-header,
          .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 1.55mm 3mm;
            border-bottom: 1px solid #e7edf5;
            background: #f8fbff;
          }

          .summary-header p,
          .card-header p {
            margin: 0;
            color: #728196;
            font-size: 7.8px;
            font-weight: 700;
            letter-spacing: 0.18em;
            text-transform: uppercase;
          }

          .summary-table,
          table {
            width: 100%;
            border-collapse: collapse;
          }

          .table-card table {
            border-collapse: separate;
            border-spacing: 0;
            table-layout: fixed;
          }

          .table-card thead {
            display: table-header-group;
          }

          .table-card tfoot {
            display: table-footer-group;
          }

          .page-footer-spacer td {
            height: 11mm;
            border: 0;
            padding: 0;
            background: transparent;
          }

          .table-card col:nth-child(1) {
            width: 8%;
          }

          .table-card col:nth-child(2) {
            width: 34%;
          }

          .table-card col:nth-child(3) {
            width: 11%;
          }

          .table-card col:nth-child(4) {
            width: 8%;
          }

          .table-card col:nth-child(5) {
            width: 8%;
          }

          .table-card col:nth-child(6) {
            width: 12%;
          }

          .table-card col:nth-child(7) {
            width: 13%;
          }

          .table-card col:nth-child(8) {
            width: 14%;
          }

          .summary-table td {
            border-top: 1px solid #edf2f8;
            padding: 1.2mm 2.5mm;
            color: #172033;
            font-size: 9.7px;
            line-height: 1.22;
            vertical-align: top;
          }

          .summary-table tr:first-child td {
            border-top: 0;
          }

          .summary-table td:first-child {
            width: 32%;
            color: #24344a;
            font-weight: 800;
          }

          .work-description {
            min-height: 5mm;
            color: #172033;
          }

          th,
          td {
            border-top: 1px solid #edf2f8;
            padding: 1.05mm 2mm;
            color: #172033;
            font-size: 9.1px;
            line-height: 1.24;
            vertical-align: middle;
          }

          .table-card th,
          .table-card td {
            border-left: 1px solid #e5ebf3;
          }

          .table-card th:first-child,
          .table-card td:first-child {
            border-left: 0;
          }

          th {
            border-top: 0;
            background: #f7faff;
            color: #64748b;
            font-size: 7.2px;
            font-weight: 800;
            letter-spacing: 0.12em;
            padding-bottom: 1.35mm;
            padding-top: 1.35mm;
            text-align: center;
            text-transform: uppercase;
            vertical-align: middle;
            line-height: 1.18;
          }

          .table-card tbody tr {
            background: #ffffff;
          }

          .table-card tbody tr:nth-child(even):not(.total-row) {
            background: #fcfdff;
          }

          .table-card tbody tr.expense-row {
            background: #fffdf8;
          }

          .description-cell {
            padding-left: 2.5mm;
            vertical-align: top;
          }

          .numeric-cell {
            color: #111827;
            font-variant-numeric: tabular-nums;
            line-height: 1;
            white-space: nowrap;
          }

          .numeric-cell span {
            display: inline-block;
            padding-top: 0.35mm;
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
            font-variant-numeric: tabular-nums;
            vertical-align: top;
            padding-top: 1.45mm;
          }

          .task-name {
            color: #172033;
            font-size: 9.1px;
            font-weight: 700;
          }

          .task-description {
            margin-top: 0.55mm;
            color: #5f6f86;
            font-size: 7.8px;
            line-height: 1.27;
          }

          .line-type {
            display: inline-block;
            margin-top: 0.45mm;
            border-left: 2px solid #7186ba;
            color: #64748b;
            font-size: 7.2px;
            font-weight: 600;
            letter-spacing: 0.04em;
            padding-left: 1.4mm;
          }

          .total-row td {
            background: #f8fbff;
            font-weight: 800;
            vertical-align: middle;
          }

          .total-row .numeric-cell span {
            padding-top: 0;
          }

          .notes-body {
            padding: 1.2mm 3mm;
          }

          .notes-body p {
            margin: 0;
            color: #2d3b50;
            font-size: 8.7px;
            line-height: 1.27;
          }

          .billing-summary {
            margin-top: 1.1mm;
            padding: 0 1mm;
            color: #526175;
            font-size: 7.5px;
          }

          .footer-band {
            margin-top: auto;
            background: #7186ba;
            color: #ffffff;
            text-align: center;
            padding: 1.4mm 9mm 1.3mm;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .footer-company {
            font-size: 6.6px;
            font-weight: 700;
            line-height: 1.15;
            text-transform: uppercase;
          }

          .footer-address,
          .footer-website {
            color: rgba(255, 255, 255, 0.9);
            font-size: 5.8px;
            font-weight: 400;
            line-height: 1.15;
          }

          @media screen {
            .page {
              margin: 18px auto;
            }
          }

          @media print {
            body {
              background: #ffffff;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            .page {
              max-width: none;
              margin: 0;
            }

            .print-actions {
              display: none;
            }

            .sheet {
              min-height: auto;
              box-shadow: none;
              border-radius: 0;
              overflow: visible;
            }

            .content-shell {
              padding-bottom: 10mm;
            }

            .table-card {
              overflow: visible;
            }

            .table-card thead::before {
              content: "";
              display: table-row;
              height: 7mm;
            }

            .table-card thead tr {
              break-inside: avoid;
              page-break-inside: avoid;
            }

            .table-card tr {
              break-inside: avoid;
              page-break-inside: avoid;
            }

            .footer-band {
              position: fixed;
              right: 0;
              bottom: 0;
              left: 0;
              margin-top: 0;
              height: 8mm;
              padding: 1.25mm 9mm 1mm;
              z-index: 10;
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
                <p class="brand-logo">REFORIX<sup class="brand-mark">TM</sup></p>
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
                  <p class="doc-meta-value">${formatShortDate(documentDate)}</p>
                </div>
                <div class="doc-meta-row">
                  <p class="doc-meta-label">Revision</p>
                  <p class="doc-meta-separator">:</p>
                  <p class="doc-meta-value">${escapeHtml(revision)}</p>
                </div>
              </div>
            </div>
            <div class="doc-title-row">
              <h1>TITLE : ${escapeHtml(documentTitle)}</h1>
            </div>

            <div class="content-shell">
              <div class="sheet-grid">
                <div class="info-card">
                  <p class="section-title">Company Information</p>
                  <p class="company-line"><strong>${escapeHtml(companyDisplayName)}</strong></p>
                  <div class="party-details">
                    <div class="party-row"><span class="party-label">Address</span><span class="party-separator">:-</span><span class="party-value">${escapeHtml(company.address || "")}</span></div>
                    <div class="party-row"><span class="party-label">Phone</span><span class="party-separator">:-</span><span class="party-value">${escapeHtml(company.phone || "")}</span></div>
                    <div class="party-row"><span class="party-label">Email</span><span class="party-separator">:-</span><span class="party-value">${escapeHtml(company.email || "")}</span></div>
                    <div class="party-row"><span class="party-label">Website</span><span class="party-separator">:-</span><span class="party-value">${escapeHtml(company.website || "")}</span></div>
                  </div>
                </div>
                <div class="info-card">
                  <p class="section-title">Client Information</p>
                  <p class="company-line"><strong>${escapeHtml(client.companyName || preApproval.clientNameSnapshot)}</strong></p>
                  <div class="party-details">
                    <div class="party-row"><span class="party-label">Address</span><span class="party-separator">:-</span><span class="party-value">${escapeHtml(client.address || "")}</span></div>
                    <div class="party-row"><span class="party-label">Phone</span><span class="party-separator">:-</span><span class="party-value">${escapeHtml(client.phone || "")}</span></div>
                    <div class="party-row"><span class="party-label">Email</span><span class="party-separator">:-</span><span class="party-value">${escapeHtml(client.email || "")}</span></div>
                    <div class="party-row"><span class="party-label">Website</span><span class="party-separator">:-</span><span class="party-value">${escapeHtml(client.website || "")}</span></div>
                  </div>
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
                  <tr><td>Total bill amount</td><td>${formatCurrency(totalBilled)}</td></tr>
                  <tr><td>Work Description</td><td class="work-description">${escapeHtml(project.workDescription || preApproval.title)}</td></tr>
                </table>
              </div>

              <div class="table-card">
                <div class="card-header">
                  <p>Line Items</p>
                </div>
                <table>
                  <colgroup>
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                  </colgroup>
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
                  <tfoot>
                    <tr class="page-footer-spacer">
                      <td colspan="8"></td>
                    </tr>
                  </tfoot>
                  <tbody>
                    ${rows}
                    <tr class="total-row">
                      <td colspan="3" class="right">${includeGst ? "Subtotal" : "Total"}</td>
                      <td></td>
                      <td class="right numeric-cell"><span>${preApproval.totalHours.toFixed(2)}</span></td>
                      <td class="right numeric-cell"><span>${formatCurrency(preApproval.totalAmount)}</span></td>
                      <td class="right numeric-cell"><span>${formatCurrency(previouslyBilled)}</span></td>
                      <td class="right numeric-cell"><span>${formatCurrency(currentAmount)}</span></td>
                    </tr>
                    ${includeGst ? `
                    <tr class="total-row" style="background:#f0fdf4;">
                      <td colspan="5" class="right" style="color:#4d7c60;font-size:8.5px;letter-spacing:0.04em;">GST @ 18%</td>
                      <td class="right numeric-cell" style="color:#4d7c60;"><span>${formatCurrency(gstAmount)}</span></td>
                      <td class="right numeric-cell" style="color:#4d7c60;"><span>—</span></td>
                      <td class="right numeric-cell" style="color:#4d7c60;"><span>${formatCurrency(gstAmount)}</span></td>
                    </tr>
                    <tr class="total-row" style="background:#f0fdf4;border-top:1.5px solid #bbf7d0;">
                      <td colspan="3" class="right" style="font-size:9.5px;">Grand Total (incl. GST)</td>
                      <td></td>
                      <td class="right numeric-cell"><span>${preApproval.totalHours.toFixed(2)}</span></td>
                      <td class="right numeric-cell"><span>${formatCurrency(preApproval.totalAmount + gstAmount)}</span></td>
                      <td class="right numeric-cell"><span>${formatCurrency(previouslyBilled)}</span></td>
                      <td class="right numeric-cell"><span>${formatCurrency(currentAmountWithGst)}</span></td>
                    </tr>` : ""}
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

              <div class="billing-summary">
                Progress billing summary: Amount previously billed ${formatCurrency(previouslyBilled)}. Current amount ${formatCurrency(currentAmountWithGst)}${includeGst ? ` (incl. GST ${formatCurrency(gstAmount)})` : ""}. Total ${formatCurrency(totalBilled)}.
              </div>
              </div>
            </div>
            <div class="footer-band">
              <div class="footer-company">${escapeHtml(companyDisplayName)}</div>
              <div class="footer-address">${escapeHtml(footerAddress)}</div>
              <div class="footer-website">${escapeHtml(footerWebsite)}</div>
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
