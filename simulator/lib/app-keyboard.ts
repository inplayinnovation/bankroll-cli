"use client";

// While an app is open the keyboard is the app's: a key pressed anywhere on
// the page should reach the game, the way it does in any window that holds one.
//
// A key goes to whichever document has focus, and the app is another document,
// in a frame. Nothing can forward a key into it, so the frame is given focus
// instead. It gets it when the app opens, and gets it back whenever the
// simulator's own controls are done with it: after a click, after Escape, when
// a menu closes, and when the window comes back to the front. A key pressed
// with focus nowhere sends it there too, so at worst that one key is lost.
//
// A click on a button never takes focus from the app in the first place. An
// app can tell when it loses the keyboard, and a game pauses: looking through
// the sidebar should not stop it.
//
// The simulator keeps the keyboard where taking it would break something of
// its own: a field being typed in, a menu that is open, a press of the mouse
// until it is let go, a control reached with Tab (until Escape), and shortcuts
// while text is selected, so that it can be copied.

// Inputs that are not typed in: buttons by another name.
const NOT_TYPED = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

// Whether a menu's list is showing. A browser that cannot say is taken to be showing it.
function isOpen(select: HTMLSelectElement) {
  try {
    return select.matches(":open");
  } catch {
    return true;
  }
}

/** Whether the keyboard is in use where focus is: a field, or an open menu. */
function inUse(element: Element | null) {
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLTextAreaElement || element.isContentEditable) return true;
  if (element instanceof HTMLInputElement) return !NOT_TYPED.has(element.type);
  // An open menu's focus is on one of its options.
  const select = element.closest("select");
  return select !== null && isOpen(select);
}

const selecting = () => window.getSelection()?.isCollapsed === false;

/** Gives the keyboard to the app in the frame, and keeps giving it back. Returns how to stop. */
export function keyboardToApp(frame: HTMLIFrameElement): () => void {
  // Whether focus is in this document itself, and not in the app's. The frame
  // is this document's focused element either way: focus on the frame is not
  // always focus in it. A page from another site, for one, runs in a process
  // of its own, and focus given to the frame before it loaded does not follow
  // it there.
  let here = document.hasFocus() && document.activeElement !== frame;
  // A press of the mouse puts focus somewhere, and it stays there until the press ends.
  let pressed = false;

  /** `outside` says focus is known not to be in the frame. */
  const give = (outside = here || !document.hasFocus()) => {
    if (pressed || inUse(document.activeElement)) return;
    // Focusing the frame while it is the focused element changes nothing.
    // Letting go of it first sends focus in.
    if (outside && document.activeElement === frame) frame.blur();
    frame.focus({ preventScroll: true });
  };
  // Focus is on nothing of the simulator's own. A control reached with Tab is something.
  const idle = () => document.activeElement === document.body || document.activeElement === frame;
  const giveIfIdle = () => {
    if (idle() && !selecting()) give();
  };

  const onPress = () => {
    pressed = true;
  };
  const onRelease = () => {
    pressed = false;
    // By the next turn a click has done its work: a menu it opened is open, a choice it made is made.
    setTimeout(() => {
      if (!selecting()) give();
    });
  };
  // A press whose release is never heard here: the browser's own menu takes
  // it, and so does leaving for another window.
  const onLostPress = () => {
    pressed = false;
  };
  const keepFocus = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!idle()) return;
    // A shortcut is for the selected text. Any other key is for the app.
    if (selecting() && (event.metaKey || event.ctrlKey || event.shiftKey)) return;
    // Heard here, so focus is not in the frame, whatever is on it.
    give(true);
  };
  // Escape closes an open menu first; by the time the key comes up, it has.
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Escape") give();
  };
  // Focus that leaves a control for nothing, as a menu's does once a choice is made.
  const afterLeaving = (event: FocusEvent) => {
    if (event.relatedTarget === null) setTimeout(giveIfIdle);
  };
  const onWindowFocus = () => {
    here = true;
    // Back from another window, with focus on nothing. Focus on the frame is
    // left alone: a press outside the app comes through here on its way to
    // taking focus off the frame.
    if (document.activeElement === document.body && !selecting()) give();
  };
  const onWindowBlur = () => {
    here = false;
    onLostPress();
  };

  give();
  frame.addEventListener("load", giveIfIdle);
  document.addEventListener("pointerdown", onPress);
  document.addEventListener("pointerup", onRelease);
  document.addEventListener("pointercancel", onRelease);
  document.addEventListener("contextmenu", onLostPress);
  document.addEventListener("mousedown", keepFocus);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("focusout", afterLeaving);
  window.addEventListener("focus", onWindowFocus);
  window.addEventListener("blur", onWindowBlur);
  return () => {
    frame.removeEventListener("load", giveIfIdle);
    document.removeEventListener("pointerdown", onPress);
    document.removeEventListener("pointerup", onRelease);
    document.removeEventListener("pointercancel", onRelease);
    document.removeEventListener("contextmenu", onLostPress);
    document.removeEventListener("mousedown", keepFocus);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("focusout", afterLeaving);
    window.removeEventListener("focus", onWindowFocus);
    window.removeEventListener("blur", onWindowBlur);
  };
}
