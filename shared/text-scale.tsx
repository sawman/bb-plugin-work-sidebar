import {
  createContext,
  useContext,
  type CSSProperties,
  type PropsWithChildren,
  type ReactElement,
} from "react";

export const DEFAULT_TEXT_SCALE = 1;

const TextScaleContext = createContext(DEFAULT_TEXT_SCALE);

export function TextScaleProvider({
  scale,
  children,
}: PropsWithChildren<{ scale: number }>): ReactElement {
  return (
    <TextScaleContext.Provider value={scale}>
      {children}
    </TextScaleContext.Provider>
  );
}

export function useTextScale(): number {
  return useContext(TextScaleContext);
}

export function textScaleStyle(scale: number): CSSProperties {
  return { "--ws-text-scale": String(scale) } as CSSProperties;
}
