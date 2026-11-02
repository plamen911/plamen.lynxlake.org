const beacon = (key: string): void => {
  try {
    navigator.sendBeacon?.('/api/click', JSON.stringify({ link: key }));
  } catch {
    // Counting a click must never get in the way of following the link.
  }
};

/**
 * Reports clicks on `a[data-click]` links, added later by the chat too.
 * Counts the left and middle buttons; "Open in new tab" from the context menu
 * is not seen. The beacon outlives the page, so it holds up no navigation.
 */
export function trackClicks(doc: Document, send: (key: string) => void = beacon): void {
  const onClick = (event: Event): void => {
    if (event.type === 'auxclick' && (event as MouseEvent).button !== 1) return;
    const link = (event.target as Element | null)?.closest?.<HTMLElement>('a[data-click]');
    const key = link?.dataset.click;
    if (key) send(key);
  };
  doc.addEventListener('click', onClick);
  doc.addEventListener('auxclick', onClick);
}
