// backButton.js
// -------------
// A tiny stack of "close me" handlers so the Android hardware/gesture back
// button closes the top-most open sheet before it navigates. BottomSheet
// pushes a handler while open; useAndroidBackButton() consults the stack
// first.

const stack = [];

export function pushBackHandler(handler) {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Runs the top handler. Returns true if one consumed the back press. */
export function runTopBackHandler() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
}
