/**
 * Navigation glyphs.
 *
 * Hand-drawn 16px paths rather than an icon package: five glyphs do not
 * justify a dependency, and this keeps the bundle honest. They are
 * decorative next to a text label, so they are hidden from assistive
 * technology rather than given redundant names.
 */

export type IconName = 'map' | 'register' | 'ask' | 'report' | 'about';

const PATHS: Record<IconName, React.ReactNode> = {
  // A folded map.
  map: (
    <>
      <path d="M1.5 4.2 6 2.5v11.3L1.5 15.5V4.2Z" />
      <path d="M6 2.5l4.5 1.7v11.3L6 13.8V2.5Z" />
      <path d="M10.5 4.2 15 2.5v11.3l-4.5 1.7V4.2Z" />
    </>
  ),
  // A list.
  register: (
    <>
      <path d="M2 4h12M2 8.5h12M2 13h8" />
    </>
  ),
  // A question.
  ask: (
    <>
      <path d="M2.5 3.5h11v8h-6l-3.5 3v-3h-1.5v-8Z" />
      <path d="M8 6.2v.1M8 8.2V7.4" />
    </>
  ),
  // A pin, for reporting a place.
  report: (
    <>
      <path d="M8 14.5S13 10.4 13 6.9A5 5 0 0 0 3 6.9c0 3.5 5 7.6 5 7.6Z" />
      <circle cx="8" cy="6.8" r="1.7" />
    </>
  ),
  // An information mark.
  about: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.2v4M8 5.2v.1" />
    </>
  ),
};

export default function NavIcon({ name }: { name: IconName }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
