import * as XLSX from 'xlsx';
import {
  buildCompletedWorkbook,
  isSpreadsheetFileName,
  mergeResponses,
  parseSpreadsheet,
  SheetValidationError,
} from './task-sheet.util';

function xlsxBuffer(sheets: Record<string, any[][]>, bookType: XLSX.BookType = 'xlsx'): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
}

describe('task-sheet.util', () => {
  it('recognises spreadsheet extensions', () => {
    expect(isSpreadsheetFileName('Leads.XLSX')).toBe(true);
    expect(isSpreadsheetFileName('calls.csv')).toBe(true);
    expect(isSpreadsheetFileName('old.xls')).toBe(true);
    expect(isSpreadsheetFileName('brief.pdf')).toBe(false);
  });

  it('parses xlsx with header row, keeps long phone numbers whole, drops empty rows and columns', () => {
    const buf = xlsxBuffer({
      Leads: [
        ['Name', 'Number', '', ''],
        ['Ali Khan', 923001234567, '', ''],
        ['', '', '', ''],
        ['Sara', 923331112222, '', ''],
      ],
    });
    const { sheets, totalRows } = parseSpreadsheet(buf, 'leads.xlsx');
    expect(totalRows).toBe(2);
    expect(sheets).toEqual([
      { name: 'Leads', header: ['Name', 'Number'], rows: [['Ali Khan', '923001234567'], ['Sara', '923331112222']] },
    ]);
  });

  it('keeps leading zeros in CSV numbers', () => {
    const csv = Buffer.from('Name,Number\nAli,03001234567\n', 'utf-8');
    const { sheets } = parseSpreadsheet(csv, 'calls.csv');
    expect(sheets[0].rows[0]).toEqual(['Ali', '03001234567']);
  });

  it('reads legacy .xls and multi-sheet workbooks, naming blank headers', () => {
    const buf = xlsxBuffer({ One: [['Name', ''], ['A', 'x']], Two: [['Phone'], ['0300']] }, 'biff8');
    const { sheets, totalRows } = parseSpreadsheet(buf, 'old.xls');
    expect(totalRows).toBe(2);
    expect(sheets[0].header).toEqual(['Name', 'Column B']);
    expect(sheets[1].name).toBe('Two');
  });

  it('rejects unsupported, empty and unreadable files', () => {
    expect(() => parseSpreadsheet(Buffer.from('x'), 'notes.pdf')).toThrow(SheetValidationError);
    expect(() => parseSpreadsheet(xlsxBuffer({ S: [['Only header']] }), 'h.xlsx')).toThrow(/No data rows/);
  });

  it('merges only allowed response/remarks values and counts answered rows', () => {
    const sheets = [{ name: 'S', header: ['Name', 'Number'], rows: [['A', '1'], ['B', '2'], ['C', '3']] }];
    const t1 = new Date('2026-11-13T09:00:00Z');
    const first = mergeResponses(sheets, null, {
      '0:0': { response: 'Responded', remarks: 'Interested' },
      '0:1': { remarks: 'Busy, try later' },
    }, t1);
    expect(first.answeredRows).toBe(1);
    expect(first.responses['0:1']).toEqual({ response: null, remarks: 'Busy, try later', updatedAt: t1.toISOString() });

    // Unchanged row keeps its timestamp; clearing both fields removes the row.
    const t2 = new Date('2026-11-13T10:00:00Z');
    const second = mergeResponses(sheets, first.responses, {
      '0:0': { response: 'Responded', remarks: 'Interested' },
      '0:1': { response: '', remarks: '' },
      '0:2': { response: 'Wrong Number' },
    }, t2);
    expect(second.responses['0:0'].updatedAt).toBe(t1.toISOString());
    expect(second.responses['0:1']).toBeUndefined();
    expect(second.answeredRows).toBe(2);
  });

  it('rejects unknown rows, invalid responses and long remarks', () => {
    const sheets = [{ name: 'S', header: ['Name'], rows: [['A']] }];
    expect(() => mergeResponses(sheets, null, { '0:5': { response: 'Responded' } })).toThrow(/Unknown row/);
    expect(() => mergeResponses(sheets, null, { '1:0': { response: 'Responded' } })).toThrow(/Unknown row/);
    expect(() => mergeResponses(sheets, null, { 'Name': { response: 'Responded' } } as any)).toThrow(/Unknown row/);
    expect(() => mergeResponses(sheets, null, { '0:0': { response: 'Maybe' } })).toThrow(/must be one of/);
    expect(() => mergeResponses(sheets, null, { '0:0': { remarks: 'x'.repeat(501) } })).toThrow(/at most 500/);
  });

  it('builds the completed workbook with appended columns and a summary sheet', () => {
    const sheets = [{ name: 'Leads', header: ['Name', 'Number'], rows: [['Ali', '923001234567'], ['Sara', '923331112222']] }];
    const buf = buildCompletedWorkbook(
      sheets,
      { '0:0': { response: 'Responded', remarks: 'Wants a demo', updatedAt: '2026-11-13T09:05:00.000Z' } },
      { taskTitle: 'Call list', assigneeName: 'Test Employee', status: 'SUBMITTED', submittedAt: new Date('2026-11-13T12:00:00Z') },
    );
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Leads', 'Response Summary']);
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Leads, { header: 1, defval: '' });
    expect(rows[0]).toEqual(['Name', 'Number', 'Client Response', 'Remarks', 'Last Updated']);
    expect(rows[1]).toEqual(['Ali', '923001234567', 'Responded', 'Wants a demo', '2026-11-13 14:05']);
    expect(rows[2]).toEqual(['Sara', '923331112222', '', '', '']);
    const summary = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Response Summary'], { header: 1, defval: '' });
    expect(summary).toContainEqual(['Responded', '1']);
    expect(summary).toContainEqual(['No response yet', '1']);
  });
});
