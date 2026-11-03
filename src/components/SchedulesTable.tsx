import React, { useId } from 'react';
import { CalendarClock, Loader2, Play, XCircle } from 'lucide-react';
import type { UploadJob } from '../types/shared';

interface SchedulesTableProps {
  jobs: UploadJob[];
  onTriggerNow: (jobId: string) => void;
  onCancelJob: (jobId: string) => void;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function formatSize(bytes: number): string {
  if (!bytes) return 'Text Post';
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SchedulesTable: React.FC<SchedulesTableProps> = ({
  jobs,
  onTriggerNow,
  onCancelJob,
}) => {
  const captionId = useId();

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-indigo-400" aria-hidden="true" />
          <h2 className="text-base font-semibold text-slate-100">
            Upcoming Scheduled Uploads ({jobs.length})
          </h2>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-studio-border bg-studio-panel p-8 text-center text-xs text-slate-400">
          No upcoming uploads scheduled. Use the composer above to schedule automatic
          YouTube &amp; Facebook publications.
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
                '--label-2': '"Platforms"',
                '--label-3': '"Media"',
                '--label-4': '"Scheduled For"',
                '--label-5': '"Actions"',
              } as React.CSSProperties
            }
          >
            <caption id={captionId} className="visually-hidden">
              Upcoming scheduled video and post uploads
            </caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Platforms</th>
                <th scope="col">Media</th>
                <th scope="col">Scheduled For</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const isUploading = job.overallStatus === 'uploading';
                return (
                  <tr key={job.id}>
                    <th scope="row">
                      <div className="max-w-xs">
                        <p className="truncate font-semibold text-slate-100">
                          {job.title}
                        </p>
                        {job.tags.length > 0 && (
                          <p className="mt-0.5 truncate text-[11px] font-normal text-slate-400">
                            {job.tags.map((t) => `#${t}`).join(' ')}
                          </p>
                        )}
                      </div>
                    </th>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {job.targets.map((target) => (
                          <span
                            key={target.id}
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${
                              target.status === 'uploading'
                                ? 'bg-indigo-500/20 text-indigo-300'
                                : target.status === 'completed'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {target.status === 'uploading' && (
                              <Loader2
                                className="h-3 w-3 animate-spin"
                                aria-hidden="true"
                              />
                            )}
                            {target.platform}
                            {target.targetAccountName ? ` • ${target.targetAccountName}` : ''}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="text-xs text-slate-300">
                        {job.mediaFileName
                          ? `${job.mediaFileName} (${formatSize(job.mediaSizeBytes)})`
                          : 'Text Status Post'}
                      </span>
                    </td>
                    <td>
                      <span className="whitespace-nowrap text-xs text-slate-200">
                        {formatDateTime(job.scheduledAt)}
                      </span>
                    </td>
                    <td>
                      {isUploading ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-300">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          Uploading...
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onTriggerNow(job.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/20 px-2.5 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-600/30"
                          >
                            <Play className="h-3 w-3" aria-hidden="true" />
                            <span>Run Now</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onCancelJob(job.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/25"
                          >
                            <XCircle className="h-3 w-3" aria-hidden="true" />
                            <span>Cancel</span>
                          </button>
                        </div>
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

