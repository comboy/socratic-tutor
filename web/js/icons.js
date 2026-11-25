// Small stroke icon set (24×24). icon('name') -> <svg>.
const P = {
  learn: '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9h8M8 12h5"/>',
  map: '<rect x="3" y="3.5" width="7" height="5" rx="1"/><rect x="14" y="3.5" width="7" height="5" rx="1"/><rect x="8.5" y="15.5" width="7" height="5" rx="1"/><path d="M6.5 8.5v3h11v-3M12 11.5v4"/>',
  wiki: '<path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v12H8.5A3.5 3.5 0 0 1 5 16.5z"/><path d="M5 16.5A3.5 3.5 0 0 1 8.5 13H19"/><path d="M9 8h6"/>',
  stats: '<path d="M4 20V11M10 20V5M16 20v-6M3 20h18"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.6-4.6"/>',
  left: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  right: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  pin: '<path d="M9 3.5h6l-1 6 4 3.5H6l4-3.5z"/><path d="M12 13v7.5"/>',
  back: '<path d="M14.5 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  moon: '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  book: '<path d="M4 5.5c3-1.5 5.5-1.5 8 0v14c-2.5-1.5-5-1.5-8 0zM20 5.5c-3-1.5-5.5-1.5-8 0v14c2.5-1.5 5-1.5 8 0z"/>',
  skills: '<path d="M4 6h3M4 12h3M4 18h3M10 6h10M12 12h8M12 18h8"/>',
  sessions: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  notes: '<path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M14.5 3.5V7.5h4M9 12h6M9 15.5h6"/>',
  page: '<path d="M6 3.5h8.5L18 7v13.5H6z"/><path d="M14 3.5V7h4"/><path d="M9 12l2 2 4-4"/><path d="M9 17h6"/>',
  sheet: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
  ask: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4"/><path d="M12 16.8v.2"/>',
  bulb: '<path d="M9 17.5h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  example: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 15l3-4 2.5 3 2-2.5"/>',
  lost: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 15.5c2-1.5 5-1.5 7 0M9 9.5h.01M15 9.5h.01"/>',
  skip: '<path d="M5 6l8 6-8 6zM17 6v12"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  progress: '<path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/>',
  quiz: '<path d="M7 4h10v16H7z"/><path d="M10 9l1.5 1.5L14.5 7.5M10 15h4"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  chevd: '<path d="M6 9l6 6 6-6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  feedback: '<path d="M4 5h16v11h-8.5L7 20v-4H4z"/><path d="M12 8v3.6M12 13.8v.1"/>',
  tree: '<rect x="3" y="3.5" width="6" height="4.5" rx="1"/><rect x="15" y="9.75" width="6" height="4.5" rx="1"/><rect x="3" y="16" width="6" height="4.5" rx="1"/><path d="M9 5.75h2.5a1.5 1.5 0 0 1 1.5 1.5v3.75a1 1 0 0 0 1 1h1M9 18.25h2.5a1.5 1.5 0 0 0 1.5-1.5V13a1 1 0 0 1 1-1"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  away: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c-.6.8-.6 1.7 0 2.5M11 3.5c-.6.8-.6 1.7 0 2.5M14 3.5c-.6.8-.6 1.7 0 2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  hole: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.5"/><path d="M12 8v5M12 16v.1"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
  threads: '<path d="M4 4.5h9v6H8l-3 2.5v-2.5H4z"/><path d="M11 13.5h9v6h-1v2.5l-3-2.5h-5z"/>',
  compose: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.1 0 1.7-.8 1.7-1.7 0-1.2-1-1.6-1-2.7 0-1 .8-1.6 1.7-1.6h2.3a3.8 3.8 0 0 0 3.8-3.8c0-4-3.8-7.2-8.5-7.2z"/><circle cx="7.6" cy="11.2" r="1.1"/><circle cx="10.2" cy="7.4" r="1.1"/><circle cx="14.6" cy="7.6" r="1.1"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ico ' + cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || P.dot;
  return s;
}
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) { if (!el.querySelector('.ico')) el.prepend(icon(el.dataset.icon)); }
}
