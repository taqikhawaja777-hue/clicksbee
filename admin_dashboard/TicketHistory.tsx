import React, { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { productivityApiService, Ticket } from './src/services/productivityApi.service';
import { ProductivityBadge } from './ProductivityBadge';

interface TicketHistoryProps {
  employeeId?: string;
  taskId?: string;
  taskTitlesById?: Record<string, string>;
}

const formatDuration = (ms: number): string => {
  const totalMinutes = Math.round(ms / 60000);
  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
};

const formatDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
};

export const TicketHistory: React.FC<TicketHistoryProps> = ({ employeeId, taskId, taskTitlesById }) => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchTickets = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await productivityApiService.getTickets({ employeeId, taskId, pageSize: 50 });
        if (!cancelled) setTickets(data.items);
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
  }, [employeeId, taskId]);

  return (
    <div className="w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm font-sans overflow-hidden transition-colors">
      <div className="p-6">
        <h3 className="text-xl font-bold text-slate-800 dark:text-white">Ticket History</h3>
        <p className="text-xs text-slate-400 mt-0.5">Auto-generated session summaries for closed tasks</p>
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
          <p className="text-xs mt-1 text-slate-400">Closing a task session generates a ticket here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#eeeff5] dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider">
                <th className="py-4 px-6">TASK</th>
                <th className="py-4 px-6">DATE</th>
                <th className="py-4 px-6">TRACKED TIME</th>
                <th className="py-4 px-6">SCORE</th>
                <th className="py-4 px-6 text-right">SOURCE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300">
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-4 px-6 text-slate-800 dark:text-slate-200 font-semibold">
                    {taskTitlesById?.[ticket.taskId] || ticket.taskId}
                  </td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{formatDate(ticket.createdAt)}</td>
                  <td className="py-4 px-6 text-slate-900 dark:text-white font-bold">
                    {formatDuration(ticket.trackedMs)}
                  </td>
                  <td className="py-4 px-6">
                    <ProductivityBadge score={ticket.productivityScore} />
                  </td>
                  <td className="py-4 px-6 text-right">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 capitalize">
                      {ticket.source}
                    </span>
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
