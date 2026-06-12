import { WandbQueryResult } from '../types';

/** Hide the bar column when there are too many groups to read as a chart, or
 *  when a single ungrouped aggregate leaves nothing to compare. */
const MAX_BAR_GROUPS = 30;

function fmtValue(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'n/a';
  if (Number.isInteger(v)) return String(v);
  return String(Number.parseFloat(v.toPrecision(6)));
}

/**
 * One wandb_query aggregate, rendered as a collapsible panel under the
 * assistant message: the exact groups/values/Ns the model was shown, as a
 * table plus a proportional bar per group. This is the verification surface
 * behind a [wandb: …] chip — the data arrives outside the model's text, so it
 * cannot have been paraphrased.
 */
export function QueryResultPanel({
  data,
  panelRef,
}: {
  data: WandbQueryResult;
  panelRef?: (el: HTMLDetailsElement | null) => void;
}) {
  const values = data.groups.map((g) => (g.value !== null && Number.isFinite(g.value) ? g.value : 0));
  const maxValue = Math.max(...values, 0);
  const showBars = data.groups.length > 1 && data.groups.length <= MAX_BAR_GROUPS && maxValue > 0;
  const isCount = data.agg === 'count';
  const groupLabel = data.groupby.length > 0 ? data.groupby.join(' | ') : '';
  const valueLabel = isCount ? 'N' : `${data.agg} ${data.metric}`;

  return (
    <details className="qr" open={data.groups.length <= 15} ref={panelRef}>
      <summary>
        <span className="qr-title">{data.title}</span>
      </summary>
      <table className="qr-table">
        <thead>
          <tr>
            <th>{groupLabel || 'scope'}</th>
            <th className="qr-num">{valueLabel}</th>
            {!isCount && <th className="qr-num">N</th>}
            {showBars && <th className="qr-barcell" aria-hidden="true" />}
          </tr>
        </thead>
        <tbody>
          {data.groups.map((g, i) => (
            <tr key={i}>
              <td>{g.key ?? 'all runs'}</td>
              <td className="qr-num">{fmtValue(g.value)}</td>
              {!isCount && (
                <td className="qr-num" title={g.skipped > 0 ? `${g.skipped} non-numeric value(s) skipped` : undefined}>
                  {g.n}
                  {g.skipped > 0 ? '*' : ''}
                </td>
              )}
              {showBars && (
                <td className="qr-barcell">
                  {g.value !== null && Number.isFinite(g.value) && g.value > 0 && (
                    <div className="qr-bar" style={{ width: `${(g.value / maxValue) * 100}%` }} />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="qr-foot">
        {data.matching_runs.toLocaleString()} matching runs
        {data.truncated_groups > 0 && ` · ${data.truncated_groups} more group(s) not shown`}
        {data.groups.some((g) => g.skipped > 0) && ' · * some non-numeric values skipped'}
        {' · '}
        <span className="qr-cite">{data.citation}</span>
      </div>
    </details>
  );
}
