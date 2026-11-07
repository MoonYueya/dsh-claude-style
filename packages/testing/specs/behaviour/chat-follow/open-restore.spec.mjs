/**
 * The place a reader takes while a conversation opens survives the landing that
 * opens it. The host returns from its own scroll delivery until the content it
 * shows has opened, so during a load it records nothing of what the reader
 * does, and the commit that lands the conversation at the end throws the place
 * away in one jump.
 *
 * @capability chat-follow
 * @features chat-follow
 * @risk Scrolling up while a conversation loads throws the reader back to the end once, and the place they had chosen is gone with no way to ask for it again.
 */
import { spec } from '../../fixtures/behaviour.mjs'

/** Let the skin's queued frame writes apply what the last action did. */
function nextFrames(page) {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/** The reader's distance from the end of the conversation, in pixels. */
function distanceFromEnd(page, scroller) {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector)
    return element === null ? null : element.scrollHeight - element.clientHeight - element.scrollTop
  }, scroller)
}

/** Land the conversation at its end, the way a content commit lands it. */
function landAtEnd(page, scroller) {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector)
    element.scrollTop = element.scrollHeight
  }, scroller)
}

/** Write or take away the host's follow mark on the column's wrapper. */
function followTail(page, flow, attribute, following) {
  return page.evaluate(([selector, name, on]) => {
    const wrapper = document.querySelector(selector)?.parentElement
    if (wrapper === null || wrapper === undefined) throw new Error('the conversation column has no wrapper')
    if (on) wrapper.setAttribute(name, '')
    else wrapper.removeAttribute(name)
  }, [flow, attribute, following])
}

/** The reader's own gesture over the conversation: a wheel of this many pixels upward. */
async function wheelUp(page, scroller, pixels) {
  const box = await page.locator(scroller).first().boundingBox()
  if (box === null) throw new Error('the conversation scroller is not drawn')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -pixels)
  await nextFrames(page)
}

/** The distance a reader's place is judged at, to the two pixels the accepted shape allows. */
function expectPlaceFromEnd(t, actual, expected, label) {
  const off = actual === null ? Infinity : Math.abs(actual - expected)
  t.expectThat.equal(off <= 2, true, `${label} (${String(actual)}px from the end)`)
}

export default spec({ page: 'chat-follow' }, ({ test }) => {
  test('a place taken during the load comes back after the host lands at the end', async (t) => {
    const scroller = t.host('chat.scroller')
    await landAtEnd(t.page, scroller)
    await followTail(t.page, t.host('chat.flow'), t.host('chat.following-tail-attribute'), true)
    await wheelUp(t.page, scroller, 400)
    expectPlaceFromEnd(t, await distanceFromEnd(t.page, scroller), 400, 'the reader scrolled 400px away from the end')
    // The host still follows the tail: nothing of the reader's own move reached
    // it, and the commit that opens the conversation lands at the end.
    await landAtEnd(t.page, scroller)
    await nextFrames(t.page)
    expectPlaceFromEnd(t, await distanceFromEnd(t.page, scroller), 400, 'the place stands after the landing')
  })

  test('a conversation nobody scrolled during lands at the end', async (t) => {
    const scroller = t.host('chat.scroller')
    await followTail(t.page, t.host('chat.flow'), t.host('chat.following-tail-attribute'), true)
    await landAtEnd(t.page, scroller)
    await nextFrames(t.page)
    t.expectThat.equal(Math.round(await distanceFromEnd(t.page, scroller)), 0, 'the conversation rests at its end')
  })

  test('a reader who moved after the conversation settled keeps master behaviour', async (t) => {
    const scroller = t.host('chat.scroller')
    const flow = t.host('chat.flow')
    const attribute = t.host('chat.following-tail-attribute')
    // A move inside the follow threshold is the end for every source that
    // follows it: the host lands there and the reader stays with it.
    await landAtEnd(t.page, scroller)
    await followTail(t.page, flow, attribute, true)
    await wheelUp(t.page, scroller, 20)
    await landAtEnd(t.page, scroller)
    await nextFrames(t.page)
    t.expectThat.equal(Math.round(await distanceFromEnd(t.page, scroller)), 0, 'a move inside the threshold leaves the follow alone')
    // Once the host has read a position its own way it takes the follow off, so
    // the landings after that are none and the place the reader keeps stands.
    await followTail(t.page, flow, attribute, false)
    await nextFrames(t.page)
    await wheelUp(t.page, scroller, 400)
    await landAtEnd(t.page, scroller)
    await nextFrames(t.page)
    t.expectThat.equal(Math.round(await distanceFromEnd(t.page, scroller)), 0, 'the host has taken the place over and nothing is put back')
  })
})
