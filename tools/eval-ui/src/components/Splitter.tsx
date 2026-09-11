import { useCallback, useRef, useState } from "react";

// Draggable vertical divider resizing two panes. Plain mouse events on the container —
// no drag library needed for a single one-axis splitter.
export function Splitter({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const [leftPercent, setLeftPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftPercent(Math.min(85, Math.max(15, percent)));
  }, []);

  const stopDrag = useCallback(() => {
    dragging.current = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", stopDrag);
  }, [onMouseMove]);

  function startDrag() {
    dragging.current = true;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", stopDrag);
  }

  return (
    <div className="splitter-container" ref={containerRef}>
      <div className="splitter-pane" style={{ width: `${leftPercent}%` }}>
        {left}
      </div>
      <div className="splitter-handle" onMouseDown={startDrag} />
      <div className="splitter-pane" style={{ width: `${100 - leftPercent}%` }}>
        {right}
      </div>
    </div>
  );
}
