import React from 'react';
import { MessageSquare } from 'lucide-react';
import { AttachmentChip, AttachmentRef } from './AttachmentPreviewModal';

export interface TaskReply {
  id: string;
  fileName?: string | null;
  fileUrl?: string | null;
  note?: string | null;
  createdAt: string;
  uploader?: { id: string; firstName: string; lastName: string; role?: string } | null;
}

export interface TaskWithDocuments {
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachments?: TaskReply[];
}

const formatDateTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
};

/** The assigner's original document plus every reply (note and/or file) on a task. */
export const TaskDocuments: React.FC<{
  task: TaskWithDocuments;
  currentUserId?: string;
  briefLabel?: string;
  onOpen: (attachment: AttachmentRef) => void;
}> = ({ task, currentUserId, briefLabel = 'Document', onOpen }) => {
  const replies = task.attachments || [];
  if (!task.attachmentUrl && replies.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 font-normal">
      {task.attachmentUrl && (
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-[11px] text-slate-400 font-semibold">{briefLabel}:</span>
          <AttachmentChip attachment={{ url: task.attachmentUrl, name: task.attachmentName }} onOpen={onOpen} />
        </div>
      )}
      {replies.length > 0 && (
        <div className="space-y-1.5">
          {replies.map((reply) => {
            const mine = !!currentUserId && reply.uploader?.id === currentUserId;
            const who = mine
              ? 'You'
              : reply.uploader
              ? `${reply.uploader.firstName} ${reply.uploader.lastName}`.trim()
              : 'Someone';
            return (
              <div key={reply.id} className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-400" />
                <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">{who}</span>
                  <span className="text-slate-400">{formatDateTime(reply.createdAt)}</span>
                  {reply.note && <span className="w-full sm:w-auto break-words">{reply.note}</span>}
                  {reply.fileUrl && (
                    <AttachmentChip attachment={{ url: reply.fileUrl, name: reply.fileName }} onOpen={onOpen} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TaskDocuments;
