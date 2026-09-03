import type { SVGProps } from "react";

const paths: Record<string, React.ReactNode> = {
  AlertCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4m0 4h.01" />
    </>
  ),
  ArrowLeft: <path d="M19 12H5m5-5-5 5 5 5" />,
  ArrowRight: <path d="M5 12h14m-5-5 5 5-5 5" />,
  Bot: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4M8 12h.01M16 12h.01M8 16h8" />
    </>
  ),
  Check: <path d="m5 12 4 4L19 6" />,
  ChevronDown: <path d="m6 9 6 6 6-6" />,
  ChevronRight: <path d="m9 18 6-6-6-6" />,
  ChevronUp: <path d="m6 15 6-6 6 6" />,
  Circle: <circle cx="12" cy="12" r="8" />,
  CircleHalf: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 0 0 16Z" fill="currentColor" stroke="none" />
    </>
  ),
  Clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  Columns2: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </>
  ),
  Eye: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  FolderGit: (
    <>
      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v7A2.5 2.5 0 0 1 18.5 18h-13A2.5 2.5 0 0 1 3 15.5z" />
      <path d="M9 10v4m0-4 3 2-3 2" />
    </>
  ),
  GitBranch: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M6 8v8m2 2h6a4 4 0 0 0 4-4V8" />
    </>
  ),
  GitMerge: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 8v8m2-2h6a4 4 0 0 0 4-4V8" />
    </>
  ),
  GitPullRequest: (
    <>
      <circle cx="6" cy="4" r="2" />
      <circle cx="6" cy="20" r="2" />
      <circle cx="18" cy="20" r="2" />
      <path d="M6 6v12m6-14v8a4 4 0 0 0 4 4h2" />
    </>
  ),
  GripVertical: (
    <>
      <circle cx="9" cy="5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r=".8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r=".8" fill="currentColor" stroke="none" />
      <circle cx="9" cy="19" r=".8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="19" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  Hammer: (
    <>
      <path d="m14 6 4 4" />
      <path d="m15 5 4 4-3 3-4-4z" />
      <path d="m14 10-8 8" />
      <path d="m5 19 2 2" />
    </>
  ),
  Laptop: (
    <>
      <rect x="5" y="4" width="14" height="11" rx="1.5" />
      <path d="M3 18h18M9 18l1-3h4l1 3" />
    </>
  ),
  Layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  ListTodo: (
    <>
      <path d="m4 6 1.5 1.5L8 4.5M11 6h9M4 12l1.5 1.5L8 10.5M11 12h9M4 18l1.5 1.5L8 16.5M11 18h9" />
    </>
  ),
  MessageSquare: (
    <>
      <path
        d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        data-message-bubble="true"
      />
      <path d="M7 9h10M7 13h7" />
    </>
  ),
  LoaderCircle: <path d="M12 3a9 9 0 1 0 9 9" />,
  Plus: <path d="M12 5v14M5 12h14" />,
  PriorityHigh: (
    <>
      <rect x="4" y="14" width="3" height="6" rx="1" fill="currentColor" stroke="none" data-priority-bar="active" />
      <rect x="10.5" y="10" width="3" height="10" rx="1" fill="currentColor" stroke="none" data-priority-bar="active" />
      <rect x="17" y="6" width="3" height="14" rx="1" fill="currentColor" stroke="none" data-priority-bar="active" />
    </>
  ),
  PriorityLow: (
    <>
      <rect x="4" y="14" width="3" height="6" rx="1" fill="currentColor" stroke="none" data-priority-bar="active" />
      <rect x="10.5" y="10" width="3" height="10" rx="1" fill="currentColor" stroke="none" opacity=".24" />
      <rect x="17" y="6" width="3" height="14" rx="1" fill="currentColor" stroke="none" opacity=".24" />
    </>
  ),
  PriorityMedium: (
    <>
      <rect x="4" y="14" width="3" height="6" rx="1" fill="currentColor" stroke="none" data-priority-bar="active" />
      <rect x="10.5" y="10" width="3" height="10" rx="1" fill="currentColor" stroke="none" data-priority-bar="active" />
      <rect x="17" y="6" width="3" height="14" rx="1" fill="currentColor" stroke="none" opacity=".24" />
    </>
  ),
  RefreshCw: (
    <>
      <path d="M20 11a8 8 0 0 0-14.8-4.2L3 9" />
      <path d="M3 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.8 4.2L21 15" />
      <path d="M21 20v-5h-5" />
    </>
  ),
  Search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 4 4" />
    </>
  ),
  Pin: (
    <>
      <path d="m14 4 6 6-3 2-3 5-2-2-5 3-2-2 3-5-2-3z" />
      <path d="m7 17-3 3" />
    </>
  ),
  Pencil: (
    <>
      <path d="m4 20 4.3-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5.3 16z" />
      <path d="m14.5 6.7 3 3" />
    </>
  ),
  User: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  UserClock: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 10.5-4" />
      <circle cx="18" cy="17" r="3" />
      <path d="M18 15.5V17l1 1" />
    </>
  ),
  Wrench: (
    <>
      <path d="M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17a2 2 0 1 0 2.8 2.8l5.3-5.3a4 4 0 0 0 5.2-5.2l-2.7 2.1-2.2-2.2z" />
    </>
  ),
  X: <path d="m6 6 12 12M18 6 6 18" />,
  Zzz: (
    <>
      <path d="M3 8h6l-6 6h6" />
      <path d="M11 11h4l-4 4h4" />
      <path d="M17 14h3l-3 3h3" />
    </>
  ),
};

export type IconName = keyof typeof paths;
type IconProps = SVGProps<SVGSVGElement> & { name: IconName };

export function Icon({
  name,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
  ...props
}: IconProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon={name}
      aria-hidden={ariaHidden ?? !ariaLabel}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
    >
      {paths[name] ?? <circle cx="12" cy="12" r="7" />}
    </svg>
  );
}
