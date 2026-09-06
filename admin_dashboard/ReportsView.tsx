import React, { useState, useEffect } from 'react';
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
  Camera,
  ChevronDown,
  Calendar
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { apiService } from './src/services/api.service';
import { productivityApiService, DailyReportRow } from './src/services/productivityApi.service';

export interface MonthlyReportPoint {
  month: string;
  rate: number;
}

const defaultMonthlyData: MonthlyReportPoint[] = [
  { month: 'Jan', rate: 95 },
  { month: 'Feb', rate: 92 },
  { month: 'Mar', rate: 97 },
  { month: 'Apr', rate: 93 },
  { month: 'May', rate: 96 },
  { month: 'Jun', rate: 90 },
  { month: 'Jul', rate: 94 },
  { month: 'Aug', rate: 98 },
  { month: 'Sep', rate: 93 },
  { month: 'Oct', rate: 96 },
  { month: 'Nov', rate: 95 },
  { month: 'Dec', rate: 97 },
];

export const ReportsView: React.FC = () => {
  const [chartData, setChartData] = useState<MonthlyReportPoint[]>(defaultMonthlyData);
  
  // Range selection states for the 3 download cards
  const [attendanceRange, setAttendanceRange] = useState<string>('Monthly');
  const [productivityRange, setProductivityRange] = useState<string>('Monthly');
  const [screenshotRange, setScreenshotRange] = useState<string>('Daily');
  // Which report is currently fetching data for its PDF, if any - disables
  // that card's button and shows a brief loading label, since downloading
  // now involves a real network round-trip before doc.save() instead of
  // being purely synchronous over hardcoded arrays.
  const [downloadingReport, setDownloadingReport] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://localhost:3000/api/v1/reports/attendance-analytics')
      .then(res => res.json())
      .then(data => {
        const list = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);
        if (list.length > 0) {
          setChartData(list);
        }
      })
      .catch(e => console.warn('Attendance analytics fetch error:', e));
  }, []);

  /** en-CA gives YYYY-MM-DD directly - avoids the UTC-vs-local date-string
   * bugs this app has hit before by reading the calendar date in the org's
   * fixed reference timezone rather than the machine's own local zone. */
  const formatKarachiDate = (d: Date): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d);

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
      const doc = new jsPDF();
      const nowStr = new Date().toLocaleString();
      const todayStr = formatKarachiDate(new Date());

      // WorkTrackPro Corporate Banner Header
      doc.setFillColor(79, 70, 229); // Indigo 600
      doc.rect(0, 0, 210, 28, 'F');

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
        const { rows } = await productivityApiService.getAttendanceReport(startDate, endDate);
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
        const { rows } = await productivityApiService.getProductivityReport(startDate, endDate);
        const present = rows.filter((r: DailyReportRow) => r.attendanceStatus === 'PRESENT');
        headers = ['Employee Name', 'Date', 'Active', 'Idle', 'Productivity %', 'Cisco Jabber', 'Wildix', 'Camera-Confirmed'];
        body = present.map((r: DailyReportRow) => [
          r.employeeName,
          r.date,
          formatHM(r.activeSeconds),
          formatHM(r.idleSeconds),
          `${r.productivityPercentage}%`,
          formatHM(r.jabberSeconds),
          formatHM(r.wildixSeconds),
          formatHM(r.cameraActiveSeconds),
        ]);
      } else if (reportType === 'Screenshot Report') {
        const query = new URLSearchParams({ startDate, endDate, limit: '5000' });
        const data = await apiService.get<{ data: any[] }>(`/screenshots?${query.toString()}`);
        const list = data?.data || [];
        headers = ['Employee Name', 'Date', 'Time Captured', 'Active Window'];
        body = list.map((s: any) => [
          s.user ? `${s.user.firstName} ${s.user.lastName}`.trim() : 'Unknown',
          formatKarachiDate(new Date(s.capturedAt)),
          new Date(s.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          s.activeWindowName || '—',
        ]);
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
          styles: { fontSize: 8, cellPadding: 3 },
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

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans select-none">
      
      {/* 1. TOP CHART CARD: Attendance Report — Monthly View */}
      <div className="bg-white dark:bg-slate-900 p-7 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Attendance Report — Monthly View
            </h2>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Real-time attendance rate trends queried directly from MongoDB.</p>
          </div>

          <div className="flex items-center space-x-2 bg-indigo-50 dark:bg-indigo-950/50 px-3.5 py-1.5 rounded-full border border-indigo-200/60 dark:border-indigo-800/60 text-xs font-bold text-indigo-600 dark:text-indigo-400">
            <Calendar className="w-3.5 h-3.5" />
            <span>2026 Year-to-Date Analytics</span>
          </div>
        </div>

        <div className="w-full h-80">
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
              onClick={() => generatePdfReport('Attendance Report', attendanceRange)}
              disabled={downloadingReport !== null}
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
              onClick={() => generatePdfReport('Productivity Report', productivityRange)}
              disabled={downloadingReport !== null}
              className="px-3.5 py-2 bg-[#534bf3] hover:bg-[#4338ca] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 shadow-md shadow-indigo-500/20 transition-all active:scale-98 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloadingReport === 'Productivity Report' ? 'Generating…' : 'Download PDF'}</span>
            </button>
          </div>
        </div>

        {/* Card 3: Screenshot Report */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="w-11 h-11 rounded-2xl bg-cyan-50 dark:bg-cyan-950/60 text-cyan-500 flex items-center justify-center border border-cyan-100 dark:border-cyan-900/50">
              <Camera className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                Screenshot Report
              </h3>
              <p className="text-xs text-slate-400 font-medium mt-1 leading-relaxed">
                All captured screenshot audit logs
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="relative">
              <select
                value={screenshotRange}
                onChange={(e) => setScreenshotRange(e.target.value)}
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
              onClick={() => generatePdfReport('Screenshot Report', screenshotRange)}
              disabled={downloadingReport !== null}
              className="px-3.5 py-2 bg-[#06b6d4] hover:bg-[#0891b2] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 shadow-md shadow-cyan-500/20 transition-all active:scale-98 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloadingReport === 'Screenshot Report' ? 'Generating…' : 'Download PDF'}</span>
            </button>
          </div>
        </div>

      </div>

    </div>
  );
};

export default ReportsView;
