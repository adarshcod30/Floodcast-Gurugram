/* API wrapper — reads backend URL from build-time env var */

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export const api = {
  getHealth: () => apiFetch<import('../types').HealthResponse>('/health'),
  getHotspots: () => apiFetch<import('../types').HotspotsResponse>('/api/v1/hotspots'),
  getAttractions: () => apiFetch<import('../types').AttractionsResponse>('/api/v1/attractions'),
  getForecast: () => apiFetch<import('../types').ForecastResponse>('/api/v1/forecast'),
  chat: (message: string) =>
    apiFetch<import('../types').ChatResponseData>('/api/v1/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  getAqi: () => apiFetch<import('../types').AqiResponse>('/api/v1/aqi'),
  getTransit: () => apiFetch<import('../types').TransitStatusResponse>('/api/v1/transit'),
  getUtilities: () => apiFetch<import('../types').UtilitiesListResponse>('/api/v1/utilities'),
  getRoadworks: () => apiFetch<import('../types').RoadworksListResponse>('/api/v1/roadworks'),
  getReports: () => apiFetch<import('../types').CitizenReportsListResponse>('/api/v1/community/reports'),
  postReport: (report: Omit<import('../types').CitizenReport, 'id' | 'upvotes' | 'created_at' | 'verified_by_users'>) =>
    apiFetch<import('../types').CitizenReport>('/api/v1/community/report', {
      method: 'POST',
      body: JSON.stringify(report),
    }),
  verifyReport: (id: string) =>
    apiFetch<import('../types').CitizenReport>(`/api/v1/community/report/${id}/verify`, {
      method: 'POST',
    }),
};
