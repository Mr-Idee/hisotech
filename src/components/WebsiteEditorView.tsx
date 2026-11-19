import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  DEFAULT_HOMEPAGE_CONTENT,
  HOMEPAGE_SECTION_IDS,
  normalizeHomepageContent,
  type HomepageContent,
  type HomepageSectionId,
} from '../lib/homepage';

const SECTION_LABELS: Record<HomepageSectionId, string> = {
  hero: 'Hero',
  workflow: 'Workflow',
  about: 'About',
  services: 'Services',
  projects: 'Projects',
  pricing: 'Pricing',
};

interface WebsiteEditorViewProps {
  onSaved?: (content: HomepageContent) => void;
}

export function WebsiteEditorView({ onSaved }: WebsiteEditorViewProps) {
  const [content, setContent] = useState<HomepageContent>(DEFAULT_HOMEPAGE_CONTENT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    api.getHomepageContent()
      .then(({ homepage }) => {
        if (active) setContent(normalizeHomepageContent(homepage));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load homepage content.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function updateSection(id: HomepageSectionId, update: Partial<HomepageContent[HomepageSectionId]>) {
    setSaved(false);
    setContent((current) => ({
      ...current,
      [id]: { ...current[id], ...update },
    }));
  }

  async function save() {
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const result = await api.saveHomepageContent(content);
      const normalized = normalizeHomepageContent(result.homepage);
      setContent(normalized);
      onSaved?.(normalized);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save homepage content.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D61F26]">Website builder</p>
          <h1 className="mt-1 text-2xl font-bold text-[#081E3E] dark:text-white">Homepage sections</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            Edit public homepage copy and control which sections are visible. Changes are published when saved.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={loading || saving}
          className="rounded-lg bg-[#D61F26] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </header>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {saved && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Homepage changes saved.</p>}
      {loading ? (
        <div className="rounded-xl border border-slate-200 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">
          Loading homepage sections…
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {HOMEPAGE_SECTION_IDS.map((id) => (
            <article key={id} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-bold text-[#081E3E] dark:text-white">{SECTION_LABELS[id]}</h2>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={content[id].enabled}
                    onChange={(event) => updateSection(id, { enabled: event.target.checked })}
                  />
                  Visible
                </label>
              </div>
              <label className="mb-3 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Heading
                <input
                  type="text"
                  maxLength={180}
                  value={content[id].heading}
                  onChange={(event) => updateSection(id, { heading: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Supporting text
                <textarea
                  maxLength={1200}
                  rows={4}
                  value={content[id].body}
                  onChange={(event) => updateSection(id, { body: event.target.value })}
                  className="mt-1 block w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                />
              </label>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
