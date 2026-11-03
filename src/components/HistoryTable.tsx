import React, { useId } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  History,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type { JobOverallStatus, UploadJob } from '../types/shared';

interface HistoryTableProps {
  jobs: UploadJob[];
  onRetryFailed: (jobId: string) => void;
  onOpenExternal: (url: string) => void;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function renderStatusBadge(status: JobOverallStatus) {
  switch (status) {
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Completed
        </span>
      );
    case 'partial_failure':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          Partial Failure
        </span>
      );
    case 'cancelled':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-700/70 px-2.5 py-0.5 text-xs font-medium text-slate-300">
          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Cancelled
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-medium text-red-300">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          Failed
        </span>
      );
  }
}

export const HistoryTable: React.FC<HistoryTableProps> = ({
  jobs,
  onRetryFailed,
  onOpenExternal,
}) => {
  const captionId = useId();

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-slate-400" aria-hidden="true" />
        <h2 className="text-base font-semibold text-slate-100">
          Upload History ({jobs.length})
        </h2>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-studio-border bg-studio-panel p-8 text-center text-xs text-slate-400">
          Completed, cancelled, and failed upload logs will appear here.
        </div>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-labelledby={captionId}
          className="table-wrapper"
        >
          <table
            className="studio-table"
            style={
              {
                '--label-2': '"Status"',
                '--label-3': '"Platform Deliveries"',
                '--label-4': '"Updated"',
                '--label-5': '"Actions"',
              } as React.CSSProperties
            }
          >
            <caption id={captionId} className="visually-hidden">
              Completed and historical upload jobs
            </caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Platform Deliveries</th>
                <th scope="col">Updated</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const hasFailedOrCancelled = job.targets.some(
                  (t) => t.status === 'failed' || t.status === 'cancelled'
                );

                return (
                  <tr key={job.id}>
                    <th scope="row">
                      <div className="max-w-xs">
                        <p className="truncate font-semibold text-slate-100">
                          {job.title}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] font-normal text-slate-400">
                          {job.mediaFileName || 'Facebook Text Post'}
                        </p>
                      </div>
                    </th>
                    <td>{renderStatusBadge(job.overallStatus)}</td>
                    <td>
                      <div className="space-y-1.5">
                        {job.targets.map((target) => (
                          <div key={target.id} className="text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium capitalize text-slate-200">
                                {target.platform}
                                {target.targetAccountName
                                  ? ` (${target.targetAccountName})`
                                  : ''}
                                :
                              </span>

                              {target.status === 'completed' && target.remoteUrl ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenExternal(target.remoteUrl!)}
                                  className="inline-flex items-center gap-1 text-indigo-300 underline decoration-indigo-500/50 hover:text-indigo-200"
                                >
                                  <span>View Published Post</span>
                                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                </button>
                              ) : (
                                <span
                                  className={
                                    target.status === 'failed'
                                      ? 'text-red-300'
                                      : 'text-slate-400'
                                  }
                                >
                                  {target.status}
                                </span>
                              )}
                            </div>

                            {target.errorMessage && (
                              <details className="mt-1 rounded-md border border-red-500/25 bg-red-950/30 px-2.5 py-1 text-[11px] text-red-200">
                                <summary className="cursor-pointer font-medium">
                                  Inspect API Error (Attempt #{target.retryCount})
                                </summary>
                                <p className="mt-1 break-words font-mono text-[11px] text-red-200/90">
                                  {target.errorMessage}
                                </p>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="whitespace-nowrap text-xs text-slate-300">
                        {formatDateTime(job.updatedAt)}
                      </span>
                    </td>
                    <td>
                      {hasFailedOrCancelled ? (
                        <button
                          type="button"
                          onClick={() => onRetryFailed(job.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-1.5 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/25"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Retry Failed Target</span>
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

