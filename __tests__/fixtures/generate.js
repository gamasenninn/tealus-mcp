/**
 * Test fixtures generator
 *
 * Re-generate sample.pdf / sample.docx / sample.xlsx by running:
 *   node __tests__/fixtures/generate.js
 *
 * Used dev dependencies: pdf-lib, docx, exceljs
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const docxLib = require('docx');
const ExcelJS = require('exceljs');

const FIXTURES_DIR = __dirname;

async function genPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]); // A4
  page.drawText('Hello PDF World', {
    x: 50, y: 750, size: 18, font, color: rgb(0, 0, 0),
  });
  page.drawText('This is a sample PDF for tealus-mcp read_document tests.', {
    x: 50, y: 720, size: 12, font, color: rgb(0, 0, 0),
  });
  page.drawText('Tealus context space + D4 philosophy.', {
    x: 50, y: 700, size: 12, font, color: rgb(0, 0, 0),
  });
  const bytes = await pdf.save();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'sample.pdf'), bytes);
  console.log(`✓ sample.pdf (${bytes.length} bytes)`);
}

async function genDocx() {
  const { Document, Packer, Paragraph, TextRun } = docxLib;
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          children: [new TextRun({ text: 'Hello DOCX World', bold: true, size: 36 })],
        }),
        new Paragraph({
          children: [new TextRun('This is a sample DOCX for tealus-mcp read_document tests.')],
        }),
        new Paragraph({
          children: [new TextRun('Tealus context space + D4 philosophy.')],
        }),
      ],
    }],
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(FIXTURES_DIR, 'sample.docx'), buffer);
  console.log(`✓ sample.docx (${buffer.length} bytes)`);
}

async function genXlsx() {
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Members');
  s1.addRow(['name', 'role', 'joined']);
  s1.addRow(['Alice', 'engineer', '2024-01-15']);
  s1.addRow(['Bob', 'designer', '2024-03-22']);
  s1.addRow(['Carol', 'pm', '2024-06-01']);
  const s2 = wb.addWorksheet('Inventory');
  s2.addRow(['item', 'qty', 'price']);
  s2.addRow(['apple', 100, 120]);
  s2.addRow(['orange', 50, 150]);
  await wb.xlsx.writeFile(path.join(FIXTURES_DIR, 'sample.xlsx'));
  const stat = fs.statSync(path.join(FIXTURES_DIR, 'sample.xlsx'));
  console.log(`✓ sample.xlsx (${stat.size} bytes)`);
}

(async () => {
  await genPdf();
  await genDocx();
  await genXlsx();
  console.log('All fixtures generated.');
})().catch(err => { console.error(err); process.exit(1); });
