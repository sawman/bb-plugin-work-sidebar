import type { ComponentType, PropsWithChildren, ReactElement } from "react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";

/** Render an isolated component with the host context required by SDK UI. */
export function renderPluginComponent(
  ui: ReactElement,
  options?: { wrapper?: ComponentType<PropsWithChildren> },
) {
  const Wrapper = options?.wrapper;
  const wrap = (content: ReactElement) =>
    Wrapper ? <Wrapper>{content}</Wrapper> : content;
  const Content = ({ content }: { content: ReactElement }) => content;
  const slot = renderSlot(
    { component: Content },
    { content: wrap(ui) },
  );
  return {
    ...slot,
    rerender(nextUi: ReactElement) {
      slot.rerender(<Content content={wrap(nextUi)} />);
    },
  };
}
