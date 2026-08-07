/* Confidence tier → visual style mapping */

export interface ConfidenceStyle {
  label: string;
  shortLabel: string;
  icon: string;
  className: string;
  borderStyle: string;
  description: string;
}

export function getConfidenceStyle(confidence: string): ConfidenceStyle {
  switch (confidence) {
    case 'confirmed_named_mcg_zone1':
      return {
        label: 'MCG Confirmed',
        shortLabel: 'MCG',
        icon: '🛡️',
        className: 'confidence-mcg',
        borderStyle: 'solid',
        description: 'Officially named by MCG in their Zone 1 hotspot list',
      };
    case 'confirmed_named_multi_source':
      return {
        label: 'Multi-Source Confirmed',
        shortLabel: 'Confirmed',
        icon: '✓',
        className: 'confidence-multi',
        borderStyle: 'solid',
        description: 'Named in 2+ independent news reports across multiple years',
      };
    case 'plausible_real_unconfirmed_flood_status':
      return {
        label: 'Unconfirmed Watchlist',
        shortLabel: 'Watchlist',
        icon: '?',
        className: 'confidence-plausible',
        borderStyle: 'dashed',
        description: 'Real locality, but flood risk is unconfirmed — treat as watchlist',
      };
    case 'reconstructed_estimate':
      return {
        label: 'Reconstructed Estimate',
        shortLabel: 'Estimate',
        icon: '⚠',
        className: 'confidence-reconstructed',
        borderStyle: 'dotted',
        description: 'Structural placeholder — not found in any source reviewed',
      };
    default:
      return {
        label: 'Unknown',
        shortLabel: '?',
        icon: '?',
        className: '',
        borderStyle: 'solid',
        description: 'Unknown confidence level',
      };
  }
}
