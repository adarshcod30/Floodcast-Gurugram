/**
 * Typed API client.
 *
 * The base URL is a build-time env var so the same source points at
 * localhost in development and the Render service in production. It is
 * never hardcoded.
 *
 * COLD STARTS ARE A FIRST-CLASS CASE, NOT AN ERROR. Render's free tier
 * sleeps after inactivity and takes 30-60s to wake. A plain fetch would
 * hang and then look like a broken app. `onSlow` fires once the request
 * passes the threshold so the UI can say what is actually happening.
 */

import type {
  AirQualityResponse,
  AttractionsResponse,
  ChatResponse,
  CitizenReport,
  ForecastResponse,
  HealthResponse,
  HotspotsResponse,
  NewReport,
  ReportsResponse,
  TimelineResponse,
} from '../types';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

/** How long a request may take before we assume a cold start. */
const SLOW_MS = 2500;

/** Hard ceiling. Generous, because waking a sleeping dyno is slow. */
const TIMEOUT_MS = 75_000;

export class ApiError extends Error {
  // Declared as a field rather than a parameter property: the project
  // builds with `erasableSyntaxOnly`, which forbids the shorthand.
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface Options extends RequestInit {
  /** Called once if the request is still in flight after SLOW_MS. */
  onSlow?: () => void;
}

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { onSlow, ...init } = opts;

  const controller = new AbortController();
  const slowTimer = onSlow ? setTimeout(onSlow, SLOW_MS) : undefined;
  const killTimer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });

    if (!res.ok) {
      // Surface the server's own message where it sent one — a 422 from
      // Pydantic explains exactly which field failed, and swallowing it
      // in favour of "Request failed" wastes information the user needs.
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (typeof body?.detail === 'string') detail = body.detail;
        else if (Array.isArray(body?.detail) && body.detail[0]?.msg) detail = body.detail[0].msg;
      } catch {
        /* body was not JSON; the status line stands */
      }
      throw new ApiError(detail, res.status);
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('The server did not respond in time.');
    }
    throw new ApiError('Could not reach the server. Check your connection.');
  } finally {
    clearTimeout(killTimer);
    if (slowTimer) clearTimeout(slowTimer);
  }
}

export const api = {
  health: (onSlow?: () => void) => request<HealthResponse>('/health', { onSlow }),
  hotspots: () => request<HotspotsResponse>('/api/v1/hotspots'),
  attractions: () => request<AttractionsResponse>('/api/v1/attractions'),
  forecast: () => request<ForecastResponse>('/api/v1/forecast'),
  timeline: () => request<TimelineResponse>('/api/v1/timeline'),
  airQuality: () => request<AirQualityResponse>('/api/v1/air-quality'),
  reports: () => request<ReportsResponse>('/api/v1/reports'),

  ask: (message: string) =>
    request<ChatResponse>('/api/v1/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  fileReport: (report: NewReport) =>
    request<CitizenReport>('/api/v1/reports', {
      method: 'POST',
      body: JSON.stringify(report),
    }),

  confirmReport: (id: string) =>
    request<CitizenReport>(`/api/v1/reports/${id}/confirm`, { method: 'POST' }),
};

export const API_BASE = BASE;
