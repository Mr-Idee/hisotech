import { Camera, CheckCircle2, UserCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, compressImageFile } from '../lib/api';
import { hasPermission, INSTALLATION_STAGES } from '../lib/solar';
import type { InstallationRecord, StaffMember } from '../lib/types';

interface WorkspaceInstallationsProps {
  user: StaffMember;
  installations: InstallationRecord[];
  staff: StaffMember[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string) => void;
}

export function WorkspaceInstallations({
  user,
  installations,
  staff,
  onRefresh,
  onNotify,
}: WorkspaceInstallationsProps) {
  const [selectedJob, setSelectedJob] = useState<InstallationRecord | null>(null);
  const [stageNum, setStageNum] = useState(1);
  const [activityTitle, setActivityTitle] = useState('');
  const [reportText, setReportText] = useState('');
  const [customerVisible, setCustomerVisible] = useState(true);
  const [advanceStage, setAdvanceStage] = useState(true);
  const [photos, setPhotos] = useState<{ blob: Blob; name: string; previewUrl: string }[]>([]);
  const previewUrls = useRef<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);

  const canAssign = hasPermission(user, 'manage_enquiries') || hasPermission(user, 'release_installations');
  const technicians = staff.filter(
    (s) => (s.role === 'technician' || hasPermission(s, 'update_installations')) && s.status === 'Active'
  );

  useEffect(() => () => previewUrls.current.forEach(URL.revokeObjectURL), []);

  function clearPhotos() {
    previewUrls.current.forEach(URL.revokeObjectURL);
    previewUrls.current = [];
    setPhotos([]);
  }

  function openReportModal(job: InstallationRecord) {
    clearPhotos();
    setSelectedJob(job);
    const nextStage = Math.min(5, job.currentStage + (job.currentStage < 5 ? 1 : 0));
    setStageNum(nextStage);
    setActivityTitle(INSTALLATION_STAGES[nextStage - 1]?.title || 'Field Update');
    setReportText('');
    setCustomerVisible(true);
    setAdvanceStage(true);
    setError('');
  }

  async function handlePhotoSelect(files: FileList | null) {
    if (!files) return;
    setError('');
    try {
      const incoming = Array.from(files).slice(0, Math.max(0, 8 - photos.length));
      const compressed: Awaited<ReturnType<typeof compressImageFile>>[] = [];
      for (const file of incoming) {
        compressed.push(await compressImageFile(file));
      }
      const withPreviews = compressed.map((photo) => {
        const previewUrl = URL.createObjectURL(photo.blob);
        previewUrls.current.push(previewUrl);
        return { ...photo, previewUrl };
      });
      setPhotos((prev) => [...prev, ...withPreviews].slice(0, 8));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedJob) return;
    setBusy(true);
    setError('');
    try {
      await api.submitFieldReport({
        installationId: selectedJob.id,
        stageNumber: stageNum,
        activityTitle,
        reportText,
        isCustomerVisible: customerVisible,
        advanceStage,
        photos,
      });
      setSelectedJob(null);
      clearPhotos();
      await onRefresh();
      onNotify('Field report and site photos saved.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
          {error}
        </div>
      )}

      {installations.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-[#0B1D39]">
          No installations have been released yet.
        </div>
      )}

      {installations.map((job) => {
        const engineer = staff.find((s) => s.id === job.assignedEngineerId);
        const pct = job.currentStage * 20;
        return (
          <article
            key={job.id}
            className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono-num font-bold text-[#D61F26]">{job.jobCode}</span>
                  <span>·</span>
                  <span>{job.releaseType}</span>
                  <span>·</span>
                  <span>Target {job.targetDate}</span>
                </div>
                <h3 className="mt-1 text-xl font-bold text-[#081E3E] dark:text-white">
                  {job.customerName} — {job.location}
                </h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{job.systemSummary}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Release note: {job.releaseNote} (by {job.releasedBy})
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canAssign && (
                  <select
                    aria-label={`Assign technician for ${job.jobCode}`}
                    value={job.assignedEngineerId || ''}
                    onChange={async (e) => {
                      if (!e.target.value) return;
                      await api.assignInstallation(job.id, e.target.value);
                      await onRefresh();
                      onNotify(`Assigned technician to ${job.jobCode}.`);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-[#061327]"
                  >
                    <option value="">Assign Technician...</option>
                    {technicians.map((eng) => (
                      <option key={eng.id} value={eng.id}>
                        {eng.name}
                      </option>
                    ))}
                  </select>
                )}

                {!job.engineerAcknowledged && job.assignedEngineerId && (
                  <button
                    type="button"
                    onClick={async () => {
                      await api.acknowledgeInstallation(job.id);
                      await onRefresh();
                      onNotify(`Assignment acknowledged for ${job.jobCode}.`);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                  >
                    <UserCheck className="h-3.5 w-3.5" /> Acknowledge Job
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => openReportModal(job)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#081E3E] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#D61F26] dark:bg-[#D61F26]"
                >
                  <Camera className="h-3.5 w-3.5" /> Add Stage Report & Photos
                </button>
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-300">
                  Assigned: <strong>{engineer ? engineer.name : 'Unassigned'}</strong>{' '}
                  {job.assignedEngineerId && (
                    <span className={job.engineerAcknowledged ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600'}>
                      ({job.engineerAcknowledged ? 'Acknowledged' : 'Pending Acknowledgement'})
                    </span>
                  )}
                </span>
                <span className="font-mono-num font-bold text-[#081E3E] dark:text-white">{pct}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-[#D61F26]" style={{ width: `${pct}%` }} />
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-5">
                {INSTALLATION_STAGES.map((st) => {
                  const completed = job.currentStage > st.stage || (job.currentStage === 5 && st.stage === 5);
                  const current = job.currentStage === st.stage && job.currentStage < 5;
                  return (
                    <div
                      key={st.stage}
                      className={`rounded-lg border p-2 text-xs ${
                        completed
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                          : current
                            ? 'border-[#D61F26] bg-red-50/70 text-[#081E3E] dark:bg-red-950/30 dark:text-white'
                            : 'border-slate-200 text-slate-400 dark:border-slate-800'
                      }`}
                    >
                      <div className="font-mono-num font-bold">0{st.stage}</div>
                      <div className="font-semibold">{st.title}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {job.updates.length > 0 && (
              <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                {job.updates.map((upd) => (
                  <div
                    key={upd.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-sm dark:border-slate-800 dark:bg-[#061327]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-[#081E3E] dark:text-white">
                        Stage {upd.stageNumber} · {upd.activityTitle}
                      </span>
                      <span>
                        {upd.createdBy} · {upd.createdAt.slice(0, 10)} ·{' '}
                        {upd.isCustomerVisible ? 'Customer Visible' : 'Internal Only'}
                      </span>
                    </div>
                    <p className="mt-1.5 text-slate-700 dark:text-slate-300">{upd.reportText}</p>
                    {upd.photos.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {upd.photos.map((ph) => (
                          <button
                            key={ph.id}
                            type="button"
                            onClick={() => setLightbox(ph.fileUrl)}
                            className="h-16 w-20 overflow-hidden rounded border border-slate-300 dark:border-slate-700"
                          >
                            <img src={ph.fileUrl} alt={ph.originalName} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </article>
        );
      })}

      {/* Field Report Modal */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleSubmitReport}
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
          >
            <h4 className="text-lg font-bold text-[#081E3E] dark:text-white">
              Report Activity · {selectedJob.jobCode}
            </h4>

            <div className="mt-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium">Stage</span>
                  <select
                    value={stageNum}
                    onChange={(e) => setStageNum(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                  >
                    {INSTALLATION_STAGES.map((st) => (
                      <option key={st.stage} value={st.stage}>
                        0{st.stage} · {st.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Activity Title *</span>
                  <input
                    type="text"
                    required
                    value={activityTitle}
                    onChange={(e) => setActivityTitle(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-medium">Engineering Report *</span>
                <textarea
                  rows={3}
                  required
                  value={reportText}
                  onChange={(e) => setReportText(e.target.value)}
                  placeholder="Describe site work, voltage/earthing measurements, or issues..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>

              <div className="flex flex-wrap gap-4 pt-1 text-xs">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={advanceStage}
                    onChange={(e) => setAdvanceStage(e.target.checked)}
                  />
                  <span>Advance job to this stage</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={customerVisible}
                    onChange={(e) => setCustomerVisible(e.target.checked)}
                  />
                  <span>Visible on Customer Tracker</span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium">
                  Site Photos (compressed automatically · up to 8 images)
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => handlePhotoSelect(e.target.files)}
                  className="mt-1.5 block w-full text-xs"
                />
                {photos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {photos.map((p, idx) => (
                      <div key={idx} className="relative h-14 w-16 overflow-hidden rounded border border-slate-300">
                        <img src={p.previewUrl} alt={p.name} className="h-full w-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedJob(null);
                  clearPhotos();
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#D61F26] px-4 py-2 text-xs font-semibold text-white"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {busy ? 'Saving...' : 'Save Field Report'}
              </button>
            </div>
          </form>
        </div>
      )}

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            aria-label="Close photo viewer"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 rounded-full bg-white p-2 text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
          <img src={lightbox} alt="Site photo" className="max-h-[85vh] max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
