/* Risk level → color mapping */

export function getRiskColor(level: string): string {
  switch (level) {
    case 'critical': return '#ef4444';
    case 'high': return '#f97316';
    case 'moderate': return '#eab308';
    case 'low': return '#22c55e';
    default: return '#64748b';
  }
}

export function getRiskBgColor(level: string): string {
  switch (level) {
    case 'critical': return 'rgba(239, 68, 68, 0.15)';
    case 'high': return 'rgba(249, 115, 22, 0.15)';
    case 'moderate': return 'rgba(234, 179, 8, 0.15)';
    case 'low': return 'rgba(34, 197, 94, 0.15)';
    default: return 'rgba(100, 116, 139, 0.15)';
  }
}

export function getRiskLabel(level: string): string {
  switch (level) {
    case 'critical': return '🔴 CRITICAL';
    case 'high': return '🟠 HIGH';
    case 'moderate': return '🟡 MODERATE';
    case 'low': return '🟢 LOW';
    default: return '⚪ UNKNOWN';
  }
}
