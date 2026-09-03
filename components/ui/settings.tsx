import type { ReactNode } from "react";

export type SettingsRowLayout = "inline-toggle" | "thread-popup";

export function SettingsCard({
  title,
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-layout="narrow"
      className={`ws-settings-card ${className ?? ""}`.trim()}
    >
      {title ? <h2 className="ws-settings-card-title">{title}</h2> : null}
      {children}
    </section>
  );
}

export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <section className="ws-settings-group">
      <header className="ws-settings-group-header">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </header>
      {children ? <div className="ws-settings-group-body">{children}</div> : null}
    </section>
  );
}

export function SettingsRow({
  layout,
  className,
  children,
}: {
  layout?: SettingsRowLayout;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`ws-settings-row ${className ?? ""}`.trim()}
      data-layout={layout}
    >
      {children}
    </div>
  );
}

export function SettingsLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label className="ws-settings-label" htmlFor={htmlFor}>
      {children}
    </label>
  );
}
