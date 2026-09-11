// ponytail: detecting a blocked iframe (X-Frame-Options/CSP) reliably across browsers isn't
// feasible from JS — `load` fires either way. Simpler and just as useful: always show the
// "open in new tab" link alongside the iframe, instead of trying to detect failure first.
export function PostingPane({ url, title }: { url: string; title: string }) {
  return (
    <div className="posting-pane">
      <div className="posting-bar">
        <span className="posting-title">{title}</span>
        <a href={url} target="_blank" rel="noreferrer">
          Open in new tab ↗
        </a>
      </div>
      <iframe src={url} title={title} />
    </div>
  );
}
