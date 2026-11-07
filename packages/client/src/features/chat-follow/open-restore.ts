import { FOLLOWING_TAIL_ATTRIBUTE, FOLLOWING_TAIL_SELECTOR, FOLLOW_THRESHOLD_PX } from '@dsh-claude-style/contracts/dom'
import { subscribeMutations } from '@dsh-claude-style/engine/bus'
import { requestFrame } from '@dsh-claude-style/engine/frame'
import { conversationColumn, conversationScroller } from '@dsh-claude-style/engine/chat-dom'
import { holdReader, isReaderScrollIntent, submissionHolds, writeScroll } from '@dsh-claude-style/engine/scroll-owner'

/*
 * The place a reader takes while a conversation is opening.
 *
 * The host's viewport returns from its scroll delivery until the content it
 * shows has opened, so a reader who scrolls up while history loads is recorded
 * by nobody: not by the host, and not by the scroll owner, whose hold is taken
 * from the same reading. The host then lands the conversation at the end — a
 * content commit does it, and restore() falls back to it when no saved
 * position answers — and the place is lost in one jump.
 *
 * What the host does publish in that window is the follow mark on the column's
 * wrapper: it stands, because nothing turned it off. A place taken while it
 * stands, and farther from the end than the follow threshold, is a reader's
 * place the host has not recorded; the landing that follows is the host's own
 * write, and the place goes back over it under the reader's claim.
 */
/** The gesture events that can move a position, the same set the scroll owner reads without the find-in-page one. */
const GESTURE_TYPES = ['wheel', 'touchstart', 'touchmove', 'touchend', 'pointerdown', 'keydown']
/** A landing this close to the end is the host arriving there, not a place the reader reads at. */
const LANDING_PX = 0.5

/**
 * Watch for the place a reader takes during a conversation's opening, and put
 * it back after the host has landed at the end.
 *
 * @returns teardown: the listeners go away and nothing is put back.
 */
export function createOpenRestore() {
  /** The place to put back, with the scroller it belongs to; null while there is none. */
  let remembered: { scroller: HTMLElement, top: number } | null = null
  /**
   * Whether the gesture's own position has not been read yet. A scroll in that
   * window belongs to the reader's gesture; the host's landing is the one no
   * gesture produced, which is what tells the two writes apart.
   */
  let settling = false
  let cancelRead: (() => void) | null = null

  const distanceFromEnd = (scroller: HTMLElement) => scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop

  /** Whether the host still follows the tail, read off its own mark on the column's wrapper. */
  const followsTail = () => {
    const column = conversationColumn()
    return column !== null && column.closest(FOLLOWING_TAIL_SELECTOR) !== null
  }

  /** Take the reader's place after its gesture, or forget it when he came back to the end. */
  const settleGesture = () => {
    cancelRead = null
    settling = false
    const scroller = conversationScroller()
    // A place inside the follow threshold is the end for every source that
    // follows it, so nothing was left behind (D40).
    if (scroller === null || !scroller.isConnected || !followsTail() || distanceFromEnd(scroller) <= FOLLOW_THRESHOLD_PX) {
      remembered = null
      return
    }
    remembered = { scroller, top: scroller.scrollTop }
  }

  const noteGesture = (event: Event) => {
    if (!isReaderScrollIntent(event)) return
    const scroller = conversationScroller()
    if (scroller === null) return
    // A press or a wheel lands on what the reader put it on; a scroll key with
    // nothing else focused is the page's, which is the conversation's.
    const target = event.target
    if (event.type !== 'keydown' && !(target instanceof Node && scroller.contains(target))) return
    settling = true
    if (cancelRead === null) cancelRead = requestFrame({ read: settleGesture })
  }

  const noteScroll = (event: Event) => {
    if (remembered === null || event.target !== remembered.scroller) return
    if (settling) return
    if (distanceFromEnd(remembered.scroller) > LANDING_PX) return
    // The reader's own message is the one landing the host makes on purpose.
    if (submissionHolds()) return
    const { scroller, top } = remembered
    // The hold first: it records the position standing now, and the write below
    // replaces that reading with the reader's place, which is what the sources
    // that follow the end then stand down for.
    holdReader(scroller)
    if (!writeScroll(scroller, top, 'reader')) return
    remembered = null
  }

  const noteMark = (records: MutationRecord[]) => {
    if (remembered === null) return
    for (const record of records) {
      if (!(record.target instanceof Element) || record.target.hasAttribute(FOLLOWING_TAIL_ATTRIBUTE)) continue
      // The host turned its follow off on its own reading of the position: it
      // holds the reader's place now, and the landings after it are none of this.
      remembered = null
      return
    }
  }

  for (const type of GESTURE_TYPES) document.addEventListener(type, noteGesture, { capture: true, passive: true })
  window.addEventListener('scroll', noteScroll, { capture: true, passive: true })
  const stopMark = subscribeMutations(document.body, { subtree: true, attributes: true, attributeFilter: [FOLLOWING_TAIL_ATTRIBUTE] }, noteMark)

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    for (const type of GESTURE_TYPES) document.removeEventListener(type, noteGesture, true)
    window.removeEventListener('scroll', noteScroll, true)
    stopMark()
    if (cancelRead !== null) cancelRead()
    cancelRead = null
    remembered = null
    settling = false
  }
}
