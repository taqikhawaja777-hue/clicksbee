import React, { useState, useEffect } from 'react';
import { useEmployee } from './EmployeeContext';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { 
  Download, 
  CheckCircle2, 
  TrendingUp, 
  AlarmClock,
  ChevronDown,
  Calendar
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { apiService, IdleReportEpisode } from './src/services/api.service';
import { mongoTrackingApiService, DailyReportRow } from './src/services/mongoTrackingApi.service';

export interface MonthlyReportPoint {
  month: string;
  rate: number;
}

const currentYear = new Date().getFullYear();

export const ReportsView: React.FC = () => {
  // Each report needs its permission (server enforces it too): Attendance - Admin/HR/SM;
  // Productivity & dialer - Admin/SM; Idle Alert (screenshots + camera) - Admin only.
  const { user: reportUser } = useEmployee();
  const canReport = (p: string) => (reportUser.permissions ? reportUser.permissions.includes(p as any) : reportUser.role === 'MANAGER');
  const [chartData, setChartData] = useState<MonthlyReportPoint[]>([]);
  const [chartLoading, setChartLoading] = useState<boolean>(true);

  // Range selection states for the 3 download cards
  const [attendanceRange, setAttendanceRange] = useState<string>('Monthly');
  const [productivityRange, setProductivityRange] = useState<string>('Monthly');
  const [idleAlertRange, setIdleAlertRange] = useState<string>('Daily');
  // Which report is currently fetching data for its PDF, if any - disables
  // that card's button and shows a brief loading label, since downloading
  // now involves a real network round-trip before doc.save() instead of
  // being purely synchronous over hardcoded arrays.
  const [downloadingReport, setDownloadingReport] = useState<string | null>(null);

  /** en-CA gives YYYY-MM-DD directly - avoids the UTC-vs-local date-string
   * bugs this app has hit before by reading the calendar date in the org's
   * fixed reference timezone rather than the machine's own local zone. */
  const formatKarachiDate = (d: Date): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d);

  useEffect(() => {
    // Real attendance_status data from productivity_service - the same
    // source every other real number on this app already uses. The
    // previous version called a separate, JWT-guarded NestJS endpoint
    // with no auth header (always 401'd, silently falling back to a
    // hardcoded mock array), and that endpoint's own server-side fallback
    // also invented a rate for any month with zero records - which is why
    // future months (Oct-Dec, which haven't happened yet) showed data at
    // all. "Year-to-Date" now means exactly that: only January through
    // the current month, nothing invented for months that haven't
    // happened or have no real records yet.
    const now = new Date();
    const startOfYear = formatKarachiDate(new Date(now.getFullYear(), 0, 1));
    const today = formatKarachiDate(now);

    setChartLoading(true);
    mongoTrackingApiService
      .getAttendanceReport(startOfYear, today)
      .then(({ rows }) => {
        const byMonth = new Map<string, { present: number; total: number }>();
        for (const row of rows) {
          const monthKey = row.date.slice(0, 7); // YYYY-MM
          const bucket = byMonth.get(monthKey) || { present: 0, total: 0 };
          bucket.total += 1;
          if (row.attendanceStatus === 'PRESENT') bucket.present += 1;
          byMonth.set(monthKey, bucket);
        }

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const points: MonthlyReportPoint[] = [];
        for (let m = 0; m <= now.getMonth(); m++) {
          const key = `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}`;
          const bucket = byMonth.get(key);
          points.push({
            month: monthNames[m],
            rate: bucket && bucket.total > 0 ? Math.round((bucket.present / bucket.total) * 100) : 0,
          });
        }
        setChartData(points);
      })
      .catch((e) => console.warn('Attendance analytics fetch error:', e))
      .finally(() => setChartLoading(false));
  }, []);

  const getDateRangeForPeriod = (period: string): { startDate: string; endDate: string } => {
    const now = new Date();
    const daysBack = period === 'Weekly' ? 6 : period === 'Monthly' ? 29 : period === 'Annually' ? 364 : 0;
    const start = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    return { startDate: formatKarachiDate(start), endDate: formatKarachiDate(now) };
  };

  const formatHM = (seconds: number): string => {
    const mins = Math.round(seconds / 60);
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return `${hrs}h ${rem}m`;
  };

  const formatTime = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

  const generatePdfReport = async (reportType: string, range: string) => {
    setDownloadingReport(reportType);
    try {
      const { startDate, endDate } = getDateRangeForPeriod(range);
      // The productivity report has 15 columns - landscape so they fit.
      const isWide = reportType === 'Productivity Report';
      const doc = isWide ? new jsPDF({ orientation: 'landscape' }) : new jsPDF();
      const nowStr = new Date().toLocaleString();
      const todayStr = formatKarachiDate(new Date());

      // WorkTrackPro Corporate Banner Header
      doc.setFillColor(79, 70, 229); // Indigo 600
      doc.rect(0, 0, doc.internal.pageSize.getWidth(), 28, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('WorkTrackPro Supervisor Report', 14, 18);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated: ${nowStr}`, 145, 18);

      // Subheader
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text(`${reportType} (${range} View)`, 14, 38);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Organization: Stitch Workforce Monitor Pro  |  Scope: ${range} (${startDate} to ${endDate})`,
        14, 44,
      );

      let headers: string[] = [];
      let body: any[][] = [];

      if (reportType === 'Attendance Report') {
        const { rows } = await mongoTrackingApiService.getAttendanceReport(startDate, endDate);
        const present = rows.filter((r: DailyReportRow) => r.attendanceStatus === 'PRESENT');
        headers = ['Employee Name', 'Date', 'Check In', 'Check Out', 'Hours Worked', 'Status'];
        body = present.map((r: DailyReportRow) => [
          r.employeeName,
          r.date,
          formatTime(r.checkInAt),
          r.stillCheckedIn ? 'Shift Active' : formatTime(r.checkOutAt),
          r.stillCheckedIn ? `${formatHM(r.shiftDurationSeconds)} (Live)` : formatHM(r.shiftDurationSeconds),
          r.attendanceStatus,
        ]);
      } else if (reportType === 'Productivity Report') {
        const { rows, spreadsheetLimitMinutes } = await mongoTrackingApiService.getProductivityReport(startDate, endDate);
        const sheetLimit = (spreadsheetLimitMinutes || 60) * 60;
        const present = rows.filter((r: DailyReportRow) => r.attendanceStatus === 'PRESENT');
        headers = [
          'Employee Name', 'Date', 'Activity Tracking', 'Active', 'Idle', 'Productivity %',
          'Calls', 'Call Time', 'Dialing', 'Longest No-Call Gap', 'Unproductive', 'Spreadsheet (in Active)', 'Suspicious',
          'Cisco Jabber', '3CX', 'Yeastar Linkus Lite',
        ];
        body = present.map((r: DailyReportRow) => {
          const calls = r.hasActivitySnapshot && r.hasCallTracking;
          return [
            r.employeeName,
            r.date,
            r.hasActivitySnapshot ? 'Captured' : 'Not captured',
            r.hasActivitySnapshot ? formatHM(r.activeSeconds) : '—',
            r.hasActivitySnapshot ? formatHM(r.idleSeconds) : '—',
            r.hasActivitySnapshot ? `${r.productivityPercentage}%` : '—',
            calls ? String(r.callCount || 0) : '—',
            calls ? formatHM(r.callSeconds || 0) : '—',
            calls ? formatHM(r.dialingSeconds || 0) : '—',
            calls ? formatHM(r.longestNoCallGapSeconds || 0) : '—',
            calls ? formatHM(r.unproductiveSeconds || 0) : '—',
            calls ? `${formatHM(r.spreadsheetSeconds || 0)}${(r.spreadsheetSeconds || 0) >= sheetLimit ? ' (over limit)' : ''}` : '—',
            calls ? formatHM(r.suspiciousSeconds || 0) : '—',
            r.hasActivitySnapshot ? formatHM(r.jabberSeconds) : '—',
            r.hasActivitySnapshot ? formatHM(r.threeCxSeconds) : '—',
            r.hasActivitySnapshot ? formatHM(r.yeastarSeconds) : '—',
          ];
        });
      }

      if (body.length === 0) {
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text('No data found for this date range.', 14, 56);
      } else {
        autoTable(doc, {
          startY: 50,
          head: [headers],
          body: body,
          theme: 'striped',
          headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
          styles: isWide ? { fontSize: 6.5, cellPadding: 2 } : { fontSize: 8, cellPadding: 3 },
        });
      }

      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(`WorkTrackPro Confidential Audit Log — Page ${i} of ${pageCount}`, 14, 285);
      }

      doc.save(`${reportType.toLowerCase().replace(/\s+/g, '_')}_${range.toLowerCase()}_${todayStr}.pdf`);
    } catch (e) {
      console.error(`Failed to generate ${reportType}:`, e);
    } finally {
      setDownloadingReport(null);
    }
  };

  const karachiClock = (iso: string): string =>
    new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit' });

  const CAMERA_LABELS: Record<string, string> = { PRESENT: 'At desk', AWAY: 'Away from desk', OFF: 'Camera off' };

  /**
   * Idle Alert Report: every idle period of every employee in the range, with
   * the AI summary of what the screen showed, a per-minute list, and small
   * screenshots + camera pictures. Only idle time is ever captured.
   */
  const generateIdleAlertPdf = async (range: string) => {
    const reportType = 'Idle Alert Report';
    setDownloadingReport(reportType);
    try {
      const { startDate, endDate } = getDateRangeForPeriod(range);
      const report = (await apiService.getIdleReport(startDate, endDate))?.data;
      const episodes: IdleReportEpisode[] = [...(report?.episodes || [])].sort(
        (a, b) => a.employeeName.localeCompare(b.employeeName) || a.idleSince.localeCompare(b.idleSince),
      );

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const bottom = 280;
      let y = 0;
      // Each small screenshot links to a full-page view added at the end.
      const fullViews: {
        alias: string;
        screenshot: string | null;
        camera: string | null;
        title: string;
        fromPage: number;
        box: [number, number, number, number];
      }[] = [];
      const ensureSpace = (needed: number) => {
        if (y + needed > bottom) {
          doc.addPage();
          y = 18;
        }
      };

      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, pageWidth, 28, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('WorkTrackPro Supervisor Report', 14, 18);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated: ${new Date().toLocaleString()}`, 145, 18);

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text(`${reportType} (${range} View)`, 14, 38);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      const totalIdle = episodes.reduce((sum, e) => sum + e.idleSeconds, 0);
      doc.text(
        `Scope: ${startDate} to ${endDate}  |  ${episodes.length} idle period(s)  |  Total idle ${formatHM(totalIdle)}  |  All employees`,
        14, 44,
      );
      y = 50;
      if (report?.imagesLimited) {
        doc.text('Large range: pictures are included for the newest 100 idle periods only; the rest are text only.', 14, y);
        y += 6;
      }

      if (episodes.length === 0) {
        doc.setFontSize(10);
        doc.text('No idle periods recorded for this date range.', 14, y + 6);
      }

      for (const ep of episodes) {
        ensureSpace(40);
        doc.setFillColor(241, 245, 249);
        doc.rect(14, y, pageWidth - 28, 12, 'F');
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(10.5);
        doc.setFont('helvetica', 'bold');
        doc.text(ep.employeeName, 17, y + 7.8);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const when = `${formatKarachiDate(new Date(ep.idleSince))}  -  Idle ${karachiClock(ep.idleSince)} to ${karachiClock(ep.endedAt)}  (${formatHM(ep.idleSeconds)})${ep.stillOpen ? '  - ended by break/sign-out' : ''}`;
        doc.text(when, pageWidth - 17, y + 7.8, { align: 'right' });
        y += 16;

        doc.setFontSize(9);
        doc.setTextColor(51, 65, 85);
        const summaryLines: string[] = doc.splitTextToSize(`Summary: ${ep.summary}`, pageWidth - 28);
        ensureSpace(summaryLines.length * 4.5);
        doc.text(summaryLines, 14, y);
        y += summaryLines.length * 4.5 + 1;

        autoTable(doc, {
          startY: y,
          head: [['Time', 'Camera', 'What the screen showed (AI)']],
          body: ep.captures.map((c) => [
            karachiClock(c.capturedAt),
            CAMERA_LABELS[c.cameraStatus] || c.cameraStatus,
            c.summary || 'AI summary not available',
          ]),
          theme: 'striped',
          headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
          styles: { fontSize: 7.5, cellPadding: 1.8 },
          columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 28 } },
          margin: { left: 14, right: 14 },
        });
        y = (doc as any).lastAutoTable.finalY + 4;

        const pictures = ep.captures.filter((c) => c.screenshot || c.camera);
        if (pictures.length > 0) {
          const shotW = 58;
          const shotH = 32.6;
          const camW = 24;
          const camH = 18;
          ensureSpace(shotH + camH + 16);
          pictures.slice(0, 3).forEach((c, i) => {
            const x = 14 + i * 62;
            const label = `${karachiClock(c.capturedAt)} - ${CAMERA_LABELS[c.cameraStatus] || c.cameraStatus}`;
            const alias = `idle-${ep.id}-${i}`;
            doc.setFontSize(7.5);
            doc.setTextColor(100, 116, 139);
            doc.text(label, x, y + 3);
            try {
              if (c.screenshot) doc.addImage(c.screenshot, 'JPEG', x, y + 5, shotW, shotH, `${alias}-shot`);
              if (c.camera) doc.addImage(c.camera, 'JPEG', x, y + 7 + shotH, camW, camH, `${alias}-cam`);
            } catch (err) {
              console.warn('[IdleAlertReport] Could not add a picture:', err);
            }
            doc.setFontSize(7);
            doc.setTextColor(79, 70, 229);
            doc.text('Click picture to view full page', x + camW + 3, y + 7 + shotH + 4);
            fullViews.push({
              alias,
              screenshot: c.screenshot,
              camera: c.camera,
              title: `${ep.employeeName}  -  ${formatKarachiDate(new Date(c.capturedAt))} ${label}`,
              fromPage: doc.getCurrentPageInfo().pageNumber,
              box: [x, y + 5, shotW, shotH + 2 + camH],
            });
          });
          y += shotH + camH + 16;
        }
        y += 4;
      }

      // Full-page views (landscape), reusing the same embedded images by alias.
      for (const view of fullViews) {
        doc.addPage('a4', 'landscape');
        const page = doc.getCurrentPageInfo().pageNumber;
        const w = doc.internal.pageSize.getWidth();
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 41, 59);
        doc.text(view.title, 10, 11);
        doc.setFont('helvetica', 'normal');
        try {
          if (view.screenshot) doc.addImage(view.screenshot, 'JPEG', 10, 15, w - 20, ((w - 20) * 9) / 16, `${view.alias}-shot`);
          if (view.camera) doc.addImage(view.camera, 'JPEG', w - 52, 172, 42, 31.5, `${view.alias}-cam`);
        } catch (err) {
          console.warn('[IdleAlertReport] Could not add a full-page picture:', err);
        }
        doc.setFontSize(10);
        doc.setTextColor(79, 70, 229);
        doc.textWithLink('<  Back to report', 10, 180, { pageNumber: view.fromPage });
        doc.setPage(view.fromPage);
        doc.link(...view.box, { pageNumber: page });
        doc.setPage(page);
      }

      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(`WorkTrackPro Confidential Audit Log — Page ${i} of ${pageCount}`, 14, doc.internal.pageSize.getHeight() - 7);
      }

      doc.save(`idle_alert_report_${range.toLowerCase()}_${formatKarachiDate(new Date())}.pdf`);
    } catch (e) {
      console.error('Failed to generate Idle Alert Report:', e);
    } finally {
      setDownloadingReport(null);
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans select-none">
      
      {/* 1. TOP CHART CARD: Attendance Report — Monthly View */}
      <div className="bg-white dark:bg-slate-900 p-7 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Attendance Report — Monthly View
            </h2>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Real attendance rate per month, computed from real check-in records.</p>
          </div>

          <div className="flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3.5 py-1.5 rounded-full border border-indigo-200/60 dark:border-indigo-800/60 text-xs font-bold text-indigo-600 dark:text-indigo-400">
            <Calendar className="w-3.5 h-3.5" />
            <span>{currentYear} Year-to-Date Analytics</span>
          </div>
        </div>

        <div className="w-full h-80">
          {chartLoading && chartData.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-24">Loading attendance analytics…</p>
          ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: -10, bottom: 10 }}>
              <defs>
                <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={true} stroke="#f1f5f9" />
              <XAxis 
                dataKey="month" 
                stroke="#94a3b8" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false}
                dy={10}
              />
              <YAxis 
                domain={[0, 100]} 
                ticks={[0, 25, 50, 75, 100]} 
                stroke="#94a3b8" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false}
                dx={-10}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#0f172a', 
                  borderColor: '#334155', 
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '12px',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)'
                }}
                formatter={(val: number) => [`${val}%`, 'Attendance Rate']}
              />
              <Area 
                type="monotone" 
                dataKey="rate" 
                stroke="#6366f1" 
                strokeWidth={3} 
                fillOpacity={1} 
                fill="url(#colorRate)" 
                dot={{ r: 5, fill: '#6366f1', strokeWidth: 2, stroke: '#ffffff' }}
                activeDot={{ r: 8, fill: '#4f46e5', strokeWidth: 3, stroke: '#ffffff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
          )}
        </div>

      </div>

      {/* 2. BOTTOM REPORT CARDS (DOWNLOADABLE CARDS WITH RANGE FILTERS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* Card 1: Attendance Report */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-500 flex items-center justify-center border border-emerald-100 dark:border-emerald-900/50">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                Attendance Report
              </h3>
              <p className="text-xs text-slate-400 font-medium mt-1 leading-relaxed">
                Daily, monthly & annual attendance records
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="relative">
              <select
                value={attendanceRange}
                onChange={(e) => setAttendanceRange(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 bg-slate-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
              >
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Monthly">Monthly</option>
                <option value="Annually">Annually</option>
              </select>
              <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <button
              disabled={downloadingReport !== null || !canReport('attendance.reports')}
              title={canReport('attendance.reports') ? undefined : 'Not available for your role'}
              onClick={() => generatePdfReport('Attendance Report', attendanceRange)}
              className="px-3.5 py-2 bg-[#10b981] hover:bg-[#059669] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 shadow-md shadow-emerald-500/20 transition-all active:scale-98 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloadingReport === 'Attendance Report' ? 'Generating…' : 'Download PDF'}</span>
            </button>
          </div>
        </div>

        {/* Card 2: Productivity Report */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-500 flex items-center justify-center border border-indigo-100 dark:border-indigo-900/50">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                Productivity Report
              </h3>
              <p className="text-xs text-slate-400 font-medium mt-1 leading-relaxed">
                Team & individual performance analytics
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="relative">
              <select
                value={productivityRange}
                onChange={(e) => setProductivityRange(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 bg-slate-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
              >
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Monthly">Monthly</option>
                <option value="Annually">Annually</option>
              </select>
              <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <button
              disabled={downloadingReport !== null || !canReport('dialer.reports')}
              title={canReport('dialer.reports') ? undefined : 'Not available for your role'}
              onClick={() => generatePdfReport('Productivity Report', productivityRange)}
              className="px-3.5 py-2 bg-[#534bf3] hover:bg-[#4338ca] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 shadow-md shadow-indigo-500/20 transition-all active:scale-98 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloadingReport === 'Productivity Report' ? 'Generating…' : 'Download PDF'}</span>
            </button>
          </div>
        </div>

        {/* Card 3: Idle Alert Report (replaced the Screenshot Report) */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="w-11 h-11 rounded-2xl bg-cyan-50 dark:bg-cyan-950/60 text-cyan-500 flex items-center justify-center border border-cyan-100 dark:border-cyan-900/50">
              <AlarmClock className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                Idle Alert Report
              </h3>
              <p className="text-xs text-slate-400 font-medium mt-1 leading-relaxed">
                Every idle period: AI summary of the screen, screenshots & camera pictures
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="relative">
              <select
                value={idleAlertRange}
                onChange={(e) => setIdleAlertRange(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 bg-slate-100 dark:bg-slate-800 border border-transparent dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
              >
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Monthly">Monthly</option>
              </select>
              <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <button
              disabled={downloadingReport !== null || !canReport('screenshots.view')}
              title={canReport('screenshots.view') ? undefined : 'Not available for your role'}
              onClick={() => generateIdleAlertPdf(idleAlertRange)}
              className="px-3.5 py-2 bg-[#06b6d4] hover:bg-[#0891b2] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 shadow-md shadow-cyan-500/20 transition-all active:scale-98 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloadingReport === 'Idle Alert Report' ? 'Generating…' : 'Download PDF'}</span>
            </button>
          </div>
        </div>

      </div>

    </div>
  );
};

export default ReportsView;
