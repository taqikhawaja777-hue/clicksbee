import React, { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { apiService, TaskTicket } from './src/services/api.service';
import { ProductivityBadge } from './ProductivityBadge';

interface TicketHistoryProps {
  userId?: string;
}

const formatMinutes = (minutes: number): string => {
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
};

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

/** Tickets are completed tasks - one row per completion, from the NestJS /tasks/tickets endpoint. */
export const TicketHistory: React.FC<TicketHistoryProps> = ({ userId }) => {
  const [tickets, setTickets] = useState<TaskTicket[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchTickets = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await apiService.getTaskTickets({ userId, pageSize: 50 });
        if (!cancelled) setTickets(res.data || []);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load ticket history');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchTickets();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div className="w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm font-sans overflow-hidden transition-colors">
      <div className="p-6">
        <h3 className="text-xl font-bold text-slate-800 dark:text-white">Ticket History</h3>
        <p className="text-xs text-slate-400 mt-0.5">One ticket per completed task - tracked time, due-date result and estimate accuracy</p>
      </div>

      {error && (
        <div className="mx-6 mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-xs font-medium">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="p-12 text-center text-slate-400">Loading ticket history...</div>
      ) : tickets.length === 0 ? (
        <div className="p-12 text-center text-slate-400 bg-slate-50/50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center">
          <Inbox className="w-10 h-10 mb-2 opacity-40 text-slate-400" />
          <p className="font-semibold text-slate-700 dark:text-slate-300">No tickets yet</p>
          <p className="text-xs mt-1 text-slate-400">Completing a task generates a ticket here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#eeeff5] dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider">
                <th className="py-4 px-6">TICKET</th>
                <th className="py-4 px-6">TASK</th>
                <th className="py-4 px-6">ASSIGNED TO</th>
                <th className="py-4 px-6">COMPLETED</th>
                <th className="py-4 px-6">TRACKED / EST.</th>
                <th className="py-4 px-6">ON TIME</th>
                <th className="py-4 px-6 text-right">ACCURACY</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300">
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-4 px-6 text-xs font-mono text-indigo-600 dark:text-indigo-400">{ticket.ticketNumber || '—'}</td>
                  <td className="py-4 px-6 text-slate-800 dark:text-slate-200 font-semibold">{ticket.title}</td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{ticket.assigneeName || '—'}</td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{formatDate(ticket.completedAt)}</td>
                  <td className="py-4 px-6 text-slate-900 dark:text-white font-bold">
                    {formatMinutes(ticket.actualMinutes)}
                    <span className="text-slate-400 font-medium"> / {formatMinutes(ticket.estimatedMinutes)}</span>
                  </td>
                  <td className="py-4 px-6">
                    {ticket.onTime === null ? (
                      <span className="text-xs text-slate-400">No due date</span>
                    ) : (
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                          ticket.onTime
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                            : 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {ticket.onTime ? 'On time' : 'Late'}
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-right">
                    {ticket.estimateAccuracy === null ? (
                      <span className="text-xs text-slate-400">Not started</span>
                    ) : (
                      <ProductivityBadge score={ticket.estimateAccuracy} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TicketHistory;
