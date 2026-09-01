export function dispatchHrefClickWithoutJsdomNavigation(
  link: HTMLElement,
  event = new MouseEvent("click", { bubbles: true, cancelable: true }),
) {
  let reachedGuard = false;
  let componentPrevented = false;
  const stopJsdomNavigation = (dispatched: MouseEvent) => {
    reachedGuard = true;
    componentPrevented = dispatched.defaultPrevented;
    dispatched.preventDefault();
  };
  document.addEventListener("click", stopJsdomNavigation, { once: true });
  try {
    link.dispatchEvent(event);
  } finally {
    document.removeEventListener("click", stopJsdomNavigation);
  }
  if (!reachedGuard) {
    throw new Error("Native-link test event did not reach the document guard");
  }
  return componentPrevented;
}
