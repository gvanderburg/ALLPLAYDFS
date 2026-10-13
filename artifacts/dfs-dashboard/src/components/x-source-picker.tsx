import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import { parseXSource, defaultXSource, resetXSource, saveXSource, type XSource } from '@/lib/x-sources';
import type { DfsSport } from '@workspace/api-client-react';

export default function XSourcePicker({ sport, label, source, onChange, storageWarning }: {
  sport: DfsSport;
  label: string;
  source: XSource;
  onChange: (source: XSource) => void;
  storageWarning?: string;
}) {
  const form = useForm<{ url: string }>({ defaultValues: { url: source.url } });
  const [notice, setNotice] = useState('');
  const [warning, setWarning] = useState(storageWarning ?? '');
  const change = (input?: string) => {
    const next = input === undefined ? defaultXSource(sport) : parseXSource(input);
    onChange(next);
    form.reset({ url: next.url });
    try {
      if (input === undefined) resetXSource(sport, window.localStorage);
      else saveXSource(sport, input, window.localStorage);
      setWarning('');
      setNotice(input === undefined ? `${label} default restored in this browser.` : `${label} source saved in this browser.`);
    } catch {
      setNotice('');
      setWarning('Browser storage is unavailable. This change works for this tab only and may be lost on reload or sport switching.');
    }
  };

  return <Form {...form}>
    <form className="x-source-picker" onSubmit={form.handleSubmit(({ url }) => change(url))} noValidate>
      <label htmlFor={`x-source-${sport}`}>{label} source URL</label>
      <input id={`x-source-${sport}`} type="url" autoComplete="off" spellCheck={false}
        aria-invalid={!!form.formState.errors.url} aria-describedby={`x-source-help-${sport} x-source-error-${sport}`}
        {...form.register('url', { onChange: () => setNotice(''), validate: (value) => {
          try { parseXSource(value); return true; } catch (error) { return (error as Error).message; }
        } })} />
      <div className="x-source-actions">
        <button type="submit" className="btn btn-primary">Save source</button>
        <button type="button" className="btn btn-quiet" onClick={() => change()}>Reset to default</button>
      </div>
      <p id={`x-source-help-${sport}`}>Public profile or list only, e.g. https://x.com/UnderdogNFL or https://x.com/i/lists/123456789. X controls availability; private sources cannot be embedded. Saved on this device in this browser, not account-synced.</p>
      <p id={`x-source-error-${sport}`} className="x-source-error" role={form.formState.errors.url ? 'alert' : undefined}>{form.formState.errors.url?.message}</p>
      {warning && <p className="x-source-error" role="alert">{warning}</p>}
      {notice && <p role="status">{notice}</p>}
    </form>
  </Form>;
}
