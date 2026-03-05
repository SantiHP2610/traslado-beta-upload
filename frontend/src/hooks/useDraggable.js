/**
 * hooks/useDraggable.js
 * Minimal drag hook using mousedown / mousemove / mouseup.
 *
 * ── Why no external library (e.g. @dnd-kit/core)? ────────────────────────────
 * The draggable elements in this app (ConfirmationModal, FinalOutputBlocks) are
 * simple free-floating cards with no drop targets, no sorting, and no keyboard
 * requirements.  A full DnD library adds ~30 kB of bundle weight for features
 * we do not use.  The three-event mouse pattern is a well-understood primitive
 * that covers all our needs in ~30 lines.
 *
 * ── Why window-level listeners for mousemove and mouseup? ────────────────────
 * If listeners were on the element itself, moving the pointer faster than the
 * browser's render cycle would "lose" the drag — the cursor leaves the element's
 * bounds and the element stops following.  Attaching to window captures all
 * pointer movement regardless of where the cursor is, so the element always
 * tracks faithfully even during fast mouse sweeps.
 *
 * ── Why useRef for drag bookkeeping, not useState? ───────────────────────────
 * drag.current, startMouse.current, and startPos.current are read-during-move
 * but do not affect what is rendered.  Storing them in refs avoids triggering
 * a re-render on every mousemove event (which fires 60+ times per second on a
 * 60 Hz display).  Only setPos() — which writes the visible position — triggers
 * a render.
 *
 * @param {{ x: number, y: number }} initialPos  Starting position in pixels
 *        relative to the viewport (used with position:fixed).
 *
 * @returns {{
 *   pos:         { x: number, y: number },
 *   onMouseDown: (e: MouseEvent) => void,
 * }}
 */

import { useState, useRef, useEffect, useCallback } from 'react'

export function useDraggable(initialPos = { x: 0, y: 0 }) {
  const [pos, setPos]  = useState(initialPos)
  const dragging       = useRef(false)
  const startMouse     = useRef({ x: 0, y: 0 })
  const startPos       = useRef(initialPos)

  // onMouseDown is stable across renders — it only reads from refs, not state.
  // Using useCallback avoids re-creating this function on every render, which
  // would force child components that receive it as a prop to also re-render.
  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return   // primary button only
    e.preventDefault()           // prevent text selection during drag
    dragging.current   = true
    startMouse.current = { x: e.clientX, y: e.clientY }
    // Capture the current position at drag start via a ref trick:
    // we store the value read from state in startPos.ref so the mousemove
    // handler can reference it without stale closure issues.
    setPos((current) => {
      startPos.current = current
      return current
    })
  }, [])

  useEffect(() => {
    function onMouseMove(e) {
      if (!dragging.current) return
      const dx = e.clientX - startMouse.current.x
      const dy = e.clientY - startMouse.current.y
      setPos({
        x: startPos.current.x + dx,
        y: startPos.current.y + dy,
      })
    }

    function onMouseUp() {
      dragging.current = false
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, []) // attach once — handlers read only from refs, never from stale state

  return { pos, onMouseDown }
}
