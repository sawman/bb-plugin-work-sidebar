import type { SVGProps } from "react";

const paths: Record<string, React.ReactNode> = {
  AlertCircle: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 4h.01" /></>,
  ArrowRight: <path d="M5 12h14m-5-5 5 5-5 5" />,
  Bot: <><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8" /></>,
  Check: <path d="m5 12 4 4L19 6" />,
  Circle: <circle cx="12" cy="12" r="8" />,
  Eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  FolderGit: <><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v7A2.5 2.5 0 0 1 18.5 18h-13A2.5 2.5 0 0 1 3 15.5z" /><path d="M9 10v4m0-4 3 2-3 2" /></>,
  GitBranch: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M6 8v8m2 2h6a4 4 0 0 0 4-4V8" /></>,
  GitPullRequest: <><circle cx="6" cy="4" r="2" /><circle cx="6" cy="20" r="2" /><circle cx="18" cy="20" r="2" /><path d="M6 6v12m6-14v8a4 4 0 0 0 4 4h2" /></>,
  GripVertical: <><circle cx="9" cy="5" r=".8" fill="currentColor" stroke="none" /><circle cx="15" cy="5" r=".8" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r=".8" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r=".8" fill="currentColor" stroke="none" /><circle cx="9" cy="19" r=".8" fill="currentColor" stroke="none" /><circle cx="15" cy="19" r=".8" fill="currentColor" stroke="none" /></>,
  Hammer: <><path d="m14 6 4 4" /><path d="m15 5 4 4-3 3-4-4z" /><path d="m14 10-8 8" /><path d="m5 19 2 2" /></>,
  Laptop: <><rect x="5" y="4" width="14" height="11" rx="1.5" /><path d="M3 18h18M9 18l1-3h4l1 3" /></>,
  Layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>,
  ListTodo: <><path d="m4 6 1.5 1.5L8 4.5M11 6h9M4 12l1.5 1.5L8 10.5M11 12h9M4 18l1.5 1.5L8 16.5M11 18h9" /></>,
  LoaderCircle: <path d="M12 3a9 9 0 1 0 9 9" />,
  Plus: <path d="M12 5v14M5 12h14" />,
  RefreshCw: <><path d="M20 11a8 8 0 0 0-14.8-4.2L3 9" /><path d="M3 4v5h5" /><path d="M4 13a8 8 0 0 0 14.8 4.2L21 15" /><path d="M21 20v-5h-5" /></>,
  Pin: <><path d="m14 4 6 6-3 2-3 5-2-2-5 3-2-2 3-5-2-3z" /><path d="m7 17-3 3" /></>,
  User: <><circle cx="12" cy="8" r="3" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  Wrench: <><path d="M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17a2 2 0 1 0 2.8 2.8l5.3-5.3a4 4 0 0 0 5.2-5.2l-2.7 2.1-2.2-2.2z" /></>,
  X: <path d="m6 6 12 12M18 6 6 18" />,
};

export type IconName = keyof typeof paths;
type IconProps = SVGProps<SVGSVGElement> & { name: IconName };

export function Icon({ name, "aria-hidden": ariaHidden, "aria-label": ariaLabel, ...props }: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden ?? !ariaLabel} aria-label={ariaLabel} role={ariaLabel ? "img" : undefined}>
      {paths[name] ?? <circle cx="12" cy="12" r="7" />}
    </svg>
  );
}
