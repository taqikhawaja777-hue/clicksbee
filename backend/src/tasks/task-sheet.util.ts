import * as XLSX from 'xlsx';

/**
 * Fill-in spreadsheets attached to tasks: the manager's file is parsed into
 * plain cell text once on upload, the assignee only ever adds a client
 * response + remarks per row, and the manager downloads a rebuilt .xlsx with
 * those columns appended. The manager's own cells are never sent back by the
 * client, so they cannot be changed.
 */

export const SHEET_EXTENSIONS = ['.xlsx', '.xlsm', '.xlsb', '.xls', '.ods', '.csv', '.tsv'];
export const MAX_SHEET_FILE_BYTES = 5 * 1024 * 1024;
export const RESPONSE_OPTIONS = ['Responded', 'Not Responded', 'Call Back Later', 'Wrong Number'] as const;
export const MAX_REMARKS_LENGTH = 500;

const MAX_SHEETS = 20;
const MAX_COLUMNS = 100;
const MAX_TOTAL_ROWS = 20_000;
const MAX_TOTAL_CELLS = 300_000;
const MAX_CELL_CHARS = 1_000;

export interface ParsedSheet {
  name: string;
  header: string[];
  rows: string[][];
}

export interface SheetResponse {
  response: string | null;
  remarks: string | null;
  updatedAt: string;
}

export type SheetResponses = Record<string, SheetResponse>;

export type SheetResponseInput = Record<string, { response?: string | null; remarks?: string | null } | null>;

export class SheetValidationError extends Error {}

export function isSpreadsheetFileName(fileName: string): boolean {
  const lower = (fileName || '').toLowerCase();
  return SHEET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export const responseKey = (sheetIndex: number, rowIndex: number) => `${sheetIndex}:${rowIndex}`;

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  let text: string;
  if (cell.t === 'n' && typeof cell.v === 'number') {
    // Excel's "General" format shows long numbers (phone numbers!) in
    // scientific notation, e.g. 9.23001E+11 - keep every digit instead.
    const w = cell.w ?? '';
    text = !w || /e[+-]?\d+$/i.test(w) ? String(cell.v) : w;
  } else if (cell.t === 'b') {
    text = cell.v ? 'TRUE' : 'FALSE';
  } else if (cell.t === 'd' && cell.v instanceof Date) {
    text = cell.w ?? cell.v.toISOString().slice(0, 10);
  } else if (cell.t === 'e') {
    text = cell.w ?? '';
  } else {
    text = String(cell.w ?? cell.v);
  }
  text = text.trim();
  return text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) : text;
}

/** Parses any supported spreadsheet into plain text cells. The first non-empty row is the header. */
export function parseSpreadsheet(buffer: Buffer, fileName: string): { sheets: ParsedSheet[]; totalRows: number } {
  if (!isSpreadsheetFileName(fileName)) {
    throw new SheetValidationError(`Unsupported file type. Use one of: ${SHEET_EXTENSIONS.join(', ')}`);
  }
  if (buffer.length > MAX_SHEET_FILE_BYTES) {
    throw new SheetValidationError('Spreadsheet is larger than 5 MB');
  }

  const isText = /\.(csv|tsv)$/i.test(fileName);
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
      dense: false,
      // CSV: keep every value as typed text, so "03001234567" keeps its leading zero.
      raw: isText,
      codepage: isText ? 65001 : undefined,
      sheetRows: MAX_TOTAL_ROWS + 1,
    });
  } catch {
    throw new SheetValidationError('Could not read this spreadsheet. It may be damaged or password-protected.');
  }

  const sheets: ParsedSheet[] = [];
  let totalRows = 0;
  let totalCells = 0;

  for (const name of workbook.SheetNames.slice(0, MAX_SHEETS)) {
    const ws = workbook.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const lastCol = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1);

    const grid: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= lastCol; c++) {
        row.push(cellText(ws[XLSX.utils.encode_cell({ r, c })]));
      }
      if (row.some((v) => v !== '')) grid.push(row);
    }
    if (grid.length === 0) continue;

    // Drop trailing columns that are empty in every row.
    let width = 0;
    for (const row of grid) {
      for (let c = row.length - 1; c >= width; c--) {
        if (row[c] !== '') {
          width = c + 1;
          break;
        }
      }
    }
    const trimmed = grid.map((row) => row.slice(0, width));
    const header = trimmed[0].map((h, i) => h || `Column ${XLSX.utils.encode_col(i)}`);
    const rows = trimmed.slice(1);

    totalRows += rows.length;
    totalCells += rows.length * width;
    if (totalRows > MAX_TOTAL_ROWS) {
      throw new SheetValidationError(`Spreadsheet has more than ${MAX_TOTAL_ROWS.toLocaleString()} rows - split it into smaller files`);
    }
    if (totalCells > MAX_TOTAL_CELLS) {
      throw new SheetValidationError('Spreadsheet is too large - split it into smaller files');
    }
    sheets.push({ name, header, rows });
  }

  if (sheets.length === 0 || totalRows === 0) {
    throw new SheetValidationError('No data rows found. The first row must be the column headers, with data below it.');
  }
  return { sheets, totalRows };
}

/**
 * Merges the assignee's changed rows into the saved responses. Only known
 * row keys, an allowed response value and remarks text are accepted - there
 * is no way to send a change to the manager's own cells.
 */
export function mergeResponses(
  sheets: ParsedSheet[],
  existing: SheetResponses | null | undefined,
  changes: SheetResponseInput,
  now: Date = new Date(),
): { responses: SheetResponses; answeredRows: number } {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new SheetValidationError('responses must be an object keyed by "sheet:row"');
  }
  const responses: SheetResponses = { ...(existing || {}) };

  for (const [key, change] of Object.entries(changes)) {
    const match = /^(\d+):(\d+)$/.exec(key);
    const sheet = match ? sheets[Number(match[1])] : undefined;
    if (!match || !sheet || Number(match[2]) >= sheet.rows.length) {
      throw new SheetValidationError(`Unknown row "${key}"`);
    }

    const response = change?.response ? String(change.response).trim() : '';
    const remarks = change?.remarks ? String(change.remarks).trim() : '';
    if (response && !(RESPONSE_OPTIONS as readonly string[]).includes(response)) {
      throw new SheetValidationError(`Client response must be one of: ${RESPONSE_OPTIONS.join(', ')}`);
    }
    if (remarks.length > MAX_REMARKS_LENGTH) {
      throw new SheetValidationError(`Remarks can be at most ${MAX_REMARKS_LENGTH} characters`);
    }

    const previous = responses[key];
    if (!response && !remarks) {
      delete responses[key];
    } else if (!previous || (previous.response || '') !== response || (previous.remarks || '') !== remarks) {
      responses[key] = { response: response || null, remarks: remarks || null, updatedAt: now.toISOString() };
    }
  }

  const answeredRows = Object.values(responses).filter((r) => !!r.response).length;
  return { responses, answeredRows };
}

function karachiDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const k = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
}

function columnWidths(aoa: string[][]): { wch: number }[] {
  const widths: number[] = [];
  for (const row of aoa) {
    row.forEach((v, i) => {
      widths[i] = Math.max(widths[i] || 8, Math.min(50, (v || '').length + 2));
    });
  }
  return widths.map((wch) => ({ wch }));
}

/** The manager's sheets with Client Response / Remarks / Last Updated appended, plus a summary sheet. */
export function buildCompletedWorkbook(
  sheets: ParsedSheet[],
  responses: SheetResponses | null | undefined,
  summary: { taskTitle: string; assigneeName: string; status: string; submittedAt: Date | null },
): Buffer {
  const saved = responses || {};
  const wb = XLSX.utils.book_new();
  const counts: Record<string, number> = Object.fromEntries(RESPONSE_OPTIONS.map((o) => [o, 0]));
  let total = 0;

  sheets.forEach((sheet, si) => {
    const aoa: string[][] = [[...sheet.header, 'Client Response', 'Remarks', 'Last Updated']];
    sheet.rows.forEach((row, ri) => {
      const entry = saved[responseKey(si, ri)];
      const cells = sheet.header.map((_, c) => row[c] ?? '');
      aoa.push([...cells, entry?.response || '', entry?.remarks || '', entry ? karachiDateTime(entry.updatedAt) : '']);
      if (entry?.response && entry.response in counts) counts[entry.response]++;
      total++;
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = columnWidths(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  });

  const answered = Object.values(counts).reduce((s, n) => s + n, 0);
  const summaryAoa: string[][] = [
    ['Task', summary.taskTitle],
    ['Assigned to', summary.assigneeName],
    ['Status', summary.status === 'SUBMITTED' ? 'Sent to manager' : 'Draft (not sent yet)'],
    ['Sent at', summary.submittedAt ? karachiDateTime(summary.submittedAt.toISOString()) : '—'],
    [],
    ['Client Response', 'Rows'],
    ...RESPONSE_OPTIONS.map((o) => [o, String(counts[o])]),
    ['No response yet', String(total - answered)],
    ['Total rows', String(total)],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoa);
  summaryWs['!cols'] = [{ wch: 20 }, { wch: 40 }];
  let summaryName = 'Response Summary';
  for (let n = 2; wb.SheetNames.includes(summaryName); n++) summaryName = `Response Summary ${n}`;
  XLSX.utils.book_append_sheet(wb, summaryWs, summaryName);

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
