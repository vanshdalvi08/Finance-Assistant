import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
import type { SalarySlipSnapshot } from "@workspace/db/schema";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const black = rgb(0, 0, 0);
const white = rgb(1, 1, 1);
const headerFill = rgb(0.965, 0.973, 0.988);
const netFill = rgb(0.932, 0.952, 0.986);

function money(value: number) {
  return `INR ${Math.round(value).toLocaleString("en-IN")}`;
}

function valueText(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "";
  return String(value);
}

function fitFontSize(font: PDFFont, text: string, maxWidth: number, preferred = 8.5, minimum = 6.2) {
  let size = preferred;
  while (size > minimum && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.2;
  }
  return size;
}

function drawText(
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  size = 8.5,
  color = black,
) {
  page.drawText(value, { x, y, size, font, color });
}

function drawFittedText(
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  width: number,
  options?: { align?: "left" | "center" | "right"; size?: number; color?: ReturnType<typeof rgb> },
) {
  const text = value.trim();
  if (!text) return;
  const align = options?.align ?? "left";
  const preferred = options?.size ?? 8.5;
  const size = fitFontSize(font, text, Math.max(0, width), preferred);
  const textWidth = font.widthOfTextAtSize(text, size);
  const padding = 5;
  let tx = x + padding;
  if (align === "center") {
    tx = x + Math.max(padding, (width - textWidth) / 2);
  } else if (align === "right") {
    tx = x + width - padding - textWidth;
  }
  const ty = y + 6;
  drawText(page, font, text, tx, ty, size, options?.color ?? black);
}

function drawCell(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  options?: { fill?: ReturnType<typeof rgb>; borderWidth?: number },
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: options?.fill ?? white,
    borderColor: black,
    borderWidth: options?.borderWidth ?? 0.9,
  });
}

function detailRow(
  page: PDFPage,
  regular: PDFFont,
  x: number,
  y: number,
  leftLabel: string,
  leftValue: string,
  rightLabel: string,
  rightValue: string,
) {
  const labelWidthLeft = 108;
  const colonWidth = 10;
  const valueWidthLeft = 138;
  const labelWidthRight = 92;
  const valueWidthRight = 145;

  drawFittedText(page, regular, leftLabel, x, y, labelWidthLeft, { size: 8.4 });
  drawFittedText(page, regular, ":", x + labelWidthLeft, y, colonWidth, { align: "center", size: 8.4 });
  drawFittedText(page, regular, leftValue, x + labelWidthLeft + colonWidth, y, valueWidthLeft, { size: 8.4 });

  const rightStart = x + labelWidthLeft + colonWidth + valueWidthLeft + 12;
  drawFittedText(page, regular, rightLabel, rightStart, y, labelWidthRight, { size: 8.4 });
  drawFittedText(page, regular, ":", rightStart + labelWidthRight, y, colonWidth, { align: "center", size: 8.4 });
  drawFittedText(page, regular, rightValue, rightStart + labelWidthRight + colonWidth, y, valueWidthRight, {
    size: 8.4,
  });
}

async function loadLogo(document: PDFDocument): Promise<PDFImage | null> {
  const candidates = [
    path.resolve(process.cwd(), "artifacts", "finance-dashboard", "src", "assets", "images", "Reforix PNG cropped.png"),
    path.resolve(process.cwd(), "..", "finance-dashboard", "src", "assets", "images", "Reforix PNG cropped.png"),
    path.resolve(process.cwd(), "..", "..", "artifacts", "finance-dashboard", "src", "assets", "images", "Reforix PNG cropped.png"),
    path.resolve(process.cwd(), "artifacts", "finance-dashboard", "src", "assets", "images", "Reforix PNG.png"),
    path.resolve(process.cwd(), "..", "finance-dashboard", "src", "assets", "images", "Reforix PNG.png"),
    path.resolve(process.cwd(), "..", "..", "artifacts", "finance-dashboard", "src", "assets", "images", "Reforix PNG.png"),
    path.resolve(process.cwd(), "artifacts", "finance-dashboard", "src", "assets", "sidebar-brandmark-rx.png"),
    path.resolve(process.cwd(), "..", "finance-dashboard", "src", "assets", "sidebar-brandmark-rx.png"),
    path.resolve(process.cwd(), "..", "..", "artifacts", "finance-dashboard", "src", "assets", "sidebar-brandmark-rx.png"),
  ];

  for (const candidate of candidates) {
    try {
      return await document.embedPng(await readFile(candidate));
    } catch {
      // Try the next known workspace layout.
    }
  }

  return null;
}

function drawLogoFallback(page: PDFPage, x: number, y: number) {
  const block = 6.5;
  const buildings = [
    [0, 0, 3, 3],
    [4, 0, 3, 5],
    [8, 0, 3, 2],
    [12, 0, 2, 6],
  ];

  for (const [bx, by, bw, bh] of buildings) {
    page.drawRectangle({ x: x + bx * block, y: y + by * block, width: bw * block, height: bh * block, color: black });
    for (let row = 0; row < bh; row += 1) {
      for (let col = 0; col < bw; col += 1) {
        page.drawRectangle({
          x: x + (bx + col) * block + 2,
          y: y + (by + row) * block + 2,
          width: 2,
          height: 2,
          color: white,
        });
      }
    }
  }
}

export async function generateSalarySlipPdf(snapshot: SalarySlipSnapshot): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const italic = await document.embedFont(StandardFonts.HelveticaOblique);
  const logo = await loadLogo(document);

  const x = 36;
  const top = 806;
  const width = 523;
  const headerHeight = 78;
  const detailHeight = 124;
  const summaryHeight = 72;
  const tableHeaderHeight = 28;
  const rowHeight = 24;
  const totalsHeight = 28;
  const netHeight = 28;
  const footerHeight = 42;
  const totalHeight = headerHeight + detailHeight + summaryHeight + tableHeaderHeight + rowHeight * 5 + totalsHeight + netHeight + footerHeight;
  const bottom = top - totalHeight;

  const col0 = x;
  const col1 = x + 160;
  const col2 = x + 262;
  const col3 = x + 422;

  page.drawRectangle({ x, y: bottom, width, height: totalHeight, color: white, borderColor: black, borderWidth: 1.1 });

  const headerBottom = top - headerHeight;
  page.drawLine({ start: { x, y: headerBottom }, end: { x: x + width, y: headerBottom }, thickness: 1.05, color: black });
  if (logo) {
    const logoBoxWidth = 118;
    const logoBoxHeight = 40;
    const scaled = logo.scaleToFit(logoBoxWidth, logoBoxHeight);
    page.drawImage(logo, {
      x: x + 22 + Math.max(0, (logoBoxWidth - scaled.width) / 2),
      y: headerBottom + 16 + Math.max(0, (logoBoxHeight - scaled.height) / 2),
      width: scaled.width,
      height: scaled.height,
    });
  } else {
    drawLogoFallback(page, x + 28, headerBottom + 18);
  }

  const headerTextX = x + 156;
  const headerTextWidth = width - 190;
  const payPeriod = snapshot.payPeriod || "June 2026";
  const title = "REFORIX ENGINEERING SERVICES";
  const titleSize = fitFontSize(bold, title, headerTextWidth, 15.4, 13.2);
  drawFittedText(page, bold, title, headerTextX, top - 28, headerTextWidth, { align: "left", size: titleSize });
  drawFittedText(page, regular, snapshot.companyAddress || "Company Address", headerTextX, top - 48, headerTextWidth, {
    align: "left",
    size: 11.2,
  });
  const paySlipSize = 8.9;
  drawText(page, regular, "Pay Slip for", headerTextX, top - 68, paySlipSize);
  const paySlipLabelWidth = regular.widthOfTextAtSize("Pay Slip for", paySlipSize);
  drawText(page, bold, payPeriod, headerTextX + paySlipLabelWidth + 4, top - 68, paySlipSize);

  const detailBottom = headerBottom - detailHeight;
  page.drawLine({ start: { x, y: detailBottom }, end: { x: x + width, y: detailBottom }, thickness: 1.05, color: black });
  const detailY = headerBottom - 32;
  detailRow(
    page,
    regular,
    x + 6,
    detailY,
    "Employee ID",
    valueText(snapshot.employeeId),
    "UAN",
    valueText(snapshot.uan) || "NA",
  );
  detailRow(
    page,
    regular,
    x + 6,
    detailY - 22,
    "Employee Name",
    valueText(snapshot.employeeName),
    "PF No.",
    valueText(snapshot.pfNumber) || "NA",
  );
  detailRow(
    page,
    regular,
    x + 6,
    detailY - 44,
    "Designation",
    valueText(snapshot.designation),
    "ESI No.",
    valueText(snapshot.esiNumber) || "NA",
  );
  detailRow(
    page,
    regular,
    x + 6,
    detailY - 66,
    "Department",
    valueText(snapshot.department),
    "Bank",
    valueText(snapshot.bankName) || "NA",
  );
  detailRow(
    page,
    regular,
    x + 6,
    detailY - 88,
    "Date of Joining",
    valueText(snapshot.joiningDate),
    "Account No.",
    valueText(snapshot.bankAccountNumber) || "NA",
  );

  const summaryTop = detailBottom;
  const summaryBottom = summaryTop - summaryHeight;
  page.drawLine({ start: { x, y: summaryBottom }, end: { x: x + width, y: summaryBottom }, thickness: 1.05, color: black });

  const summaryRows = [
    [
      { label: "Gross Wages", value: money(snapshot.grossWages) },
      { label: "Payment Date", value: valueText(snapshot.paymentDate) },
    ],
    [
      { label: "Total Working Days", value: String(snapshot.totalWorkingDays) },
      { label: "Leaves", value: String(snapshot.leaveDays) },
    ],
    [
      { label: "LOP Days", value: String(snapshot.lopDays) },
      { label: "Paid Days", value: String(snapshot.paidDays) },
    ],
  ] as const;

  const summaryColWidths = [160, 102, 160, 101];
  const summaryColXs = [col0, col1, col2, col3];
  summaryRows.forEach((row, index) => {
    const rowY = summaryTop - (index + 1) * 24;
    row.forEach((cell, cellIndex) => {
      const cellX = summaryColXs[cellIndex * 2];
      const labelWidth = summaryColWidths[cellIndex * 2];
      const valueX = summaryColXs[cellIndex * 2 + 1];
      const valueWidth = summaryColWidths[cellIndex * 2 + 1];
      drawCell(page, cellX, rowY, labelWidth, 24, { borderWidth: 0.9 });
      drawCell(page, valueX, rowY, valueWidth, 24, { borderWidth: 0.9 });
      drawFittedText(page, regular, cell.label, cellX, rowY, labelWidth, { size: 8.2 });
      drawFittedText(page, regular, cell.value, valueX, rowY, valueWidth, { align: "center", size: 8.4 });
    });
  });

  const tableTop = summaryBottom - 16;
  const tableRows = 5;
  const salaryTableHeight = tableHeaderHeight + rowHeight * tableRows + totalsHeight + netHeight;

  drawCell(page, col0, tableTop - tableHeaderHeight, 160, tableHeaderHeight, { fill: headerFill, borderWidth: 0.95 });
  drawCell(page, col1, tableTop - tableHeaderHeight, 102, tableHeaderHeight, { fill: headerFill, borderWidth: 0.95 });
  drawCell(page, col2, tableTop - tableHeaderHeight, 160, tableHeaderHeight, { fill: headerFill, borderWidth: 0.95 });
  drawCell(page, col3, tableTop - tableHeaderHeight, 101, tableHeaderHeight, { fill: headerFill, borderWidth: 0.95 });
  drawFittedText(page, bold, "Earnings", col0, tableTop - tableHeaderHeight, 262, { align: "center", size: 10 });
  drawFittedText(page, bold, "Deductions", col2, tableTop - tableHeaderHeight, 261, { align: "center", size: 10 });

  const fixedEarnings = [...snapshot.earnings].slice(0, tableRows);
  const fixedDeductions = [...snapshot.deductions].slice(0, tableRows);
  for (let index = 0; index < tableRows; index += 1) {
    const rowY = tableTop - tableHeaderHeight - (index + 1) * rowHeight;
    drawCell(page, col0, rowY, 160, rowHeight, { borderWidth: 0.9 });
    drawCell(page, col1, rowY, 102, rowHeight, { borderWidth: 0.9 });
    drawCell(page, col2, rowY, 160, rowHeight, { borderWidth: 0.9 });
    drawCell(page, col3, rowY, 101, rowHeight, { borderWidth: 0.9 });

    const earning = fixedEarnings[index];
    const deduction = fixedDeductions[index];
    drawFittedText(page, regular, earning?.label ?? "", col0, rowY, 160, { size: 8.2 });
    drawFittedText(page, regular, earning ? money(earning.amount) : "", col1, rowY, 102, { align: "center", size: 8.2 });
    drawFittedText(page, regular, deduction?.label ?? "", col2, rowY, 160, { size: 8.2 });
    drawFittedText(page, regular, deduction ? money(deduction.amount) : "", col3, rowY, 101, { align: "center", size: 8.2 });
  }

  const totalsY = tableTop - tableHeaderHeight - rowHeight * tableRows - totalsHeight;
  drawCell(page, col0, totalsY, 160, totalsHeight, { borderWidth: 0.95 });
  drawCell(page, col1, totalsY, 102, totalsHeight, { borderWidth: 0.95 });
  drawCell(page, col2, totalsY, 160, totalsHeight, { borderWidth: 0.95 });
  drawCell(page, col3, totalsY, 101, totalsHeight, { borderWidth: 0.95 });
  drawFittedText(page, bold, "Total Earnings", col0, totalsY, 160, { align: "center", size: 8.6 });
  drawFittedText(page, bold, money(snapshot.totalEarnings), col1, totalsY, 102, { align: "center", size: 8.6 });
  drawFittedText(page, bold, "Total Deductions", col2, totalsY, 160, { align: "center", size: 8.6 });
  drawFittedText(page, bold, money(snapshot.totalDeductions), col3, totalsY, 101, { align: "center", size: 8.6 });

  const netRowY = totalsY - netHeight;
  drawCell(page, col0, netRowY, 262, netHeight, { borderWidth: 0.95 });
  drawCell(page, col2, netRowY, 261, netHeight, { fill: netFill, borderWidth: 0.95 });
  drawFittedText(page, bold, "Net Salary", col2, netRowY, 160, { align: "center", size: 9.2 });
  drawFittedText(page, bold, money(snapshot.netSalary), col3, netRowY, 101, { align: "center", size: 9.2 });

  const footerTop = netRowY - 18;
  drawText(page, bold, "Note", x + 8, footerTop - 2, 7.6);
  drawText(page, regular, snapshot.note || "Salary slip generated from approved payroll records.", x + 36, footerTop - 2, 7.2);
  drawText(page, italic, "This is a computer-generated salary slip and does not require a signature.", x + 8, footerTop - 26, 6.9);

  return document.save();
}
