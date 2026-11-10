import { useEffect, useRef, useState } from 'react'
import type { Granularity, TrendPoint } from '../../../types/analytics'
import { bucketLabel, bucketNoun, hasActivity, niceScale, summarise } from '../lib/dashboard'

const SERIES = [
  { key: 'applications', label: 'Applications', color: '#14213d', dash: undefined },
  { key: 'interviews', label: 'Interviews', color: '#7c6bd6', dash: '6 4' },
  { key: 'hires', label: 'Hires', color: '#10b981', dash: '2 3' },
] as const

const M = { l: 36, r: 12, t: 12, b: 28 }
const HEIGHT = 240

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/**
 * Applications, interviews and hires over time as lines. The vertical axis always starts at zero,
 * each line has its own dash pattern (not colour alone), and a text summary and a data table are
 * provided for screen readers.
 */
export function TrendChart({ points, granularity }: { points: TrendPoint[]; granularity: Granularity }) {
  const [ref, width] = useWidth()
  if (!hasActivity(points))
    return <p className="px-5 py-10 text-center text-sm text-slate-500 sm:px-6">Nothing happened in this period yet: no applications, interviews or hires.</p>

  const { top: max, step } = niceScale(Math.max(...points.flatMap((p) => [p.applications, p.interviews, p.hires])))
  const innerW = width - M.l - M.r
  const innerH = HEIGHT - M.t - M.b
  const x = (i: number) => M.l + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const y = (v: number) => M.t + innerH - (v / max) * innerH
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 80))))
  const summaries = SERIES.map((s) => ({ ...s, ...summarise(points, s.key) }))
  const description = summaries
    .map((s) => `${s.label}: ${s.total} in total${s.peakAt ? `, most on ${bucketLabel(s.peakAt, granularity)} (${s.peak})` : ''}`)
    .join('. ')

  return (
    <figure className="p-5 sm:p-6">
      <div ref={ref}>
        <svg width={width} height={HEIGHT} role="img" aria-label={`Trend per ${bucketNoun(granularity)}. ${description}.`} className="block max-w-full">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={width - M.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={M.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#64748b">
                {t}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % every === 0 ? (
              <text key={p.bucket_start} x={x(i)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="#64748b">
                {bucketLabel(p.bucket_start, granularity)}
              </text>
            ) : null,
          )}
          {SERIES.map((s) => (
            <g key={s.key}>
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dash}
                strokeLinejoin="round"
                points={points.map((p, i) => `${x(i)},${y(p[s.key])}`).join(' ')}
              />
              {points.length <= 31 &&
                points.map((p, i) => (
                  <circle key={p.bucket_start} cx={x(i)} cy={y(p[s.key])} r={2.5} fill={s.color}>
                    <title>{`${bucketLabel(p.bucket_start, granularity)}: ${p[s.key]} ${s.label.toLowerCase()}`}</title>
                  </circle>
                ))}
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <svg width="22" height="6" aria-hidden="true">
              <line x1="0" x2="22" y1="3" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
            </svg>
            {s.label}
          </span>
        ))}
        <span className="text-slate-500">Each point is one {bucketNoun(granularity)}. The scale starts at 0.</span>
      </figcaption>
      <table className="sr-only">
        <caption>Data behind the trend chart</caption>
        <thead>
          <tr>
            <th scope="col">{granularity === 'month' ? 'Month' : granularity === 'week' ? 'Week starting' : 'Day'}</th>
            <th scope="col">Applications</th>
            <th scope="col">Interviews</th>
            <th scope="col">Hires</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.bucket_start}>
              <th scope="row">{bucketLabel(p.bucket_start, granularity)}</th>
              <td>{p.applications}</td>
              <td>{p.interviews}</td>
              <td>{p.hires}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
