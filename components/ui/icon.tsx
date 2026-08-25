export function Icon({ name, ...props }: { name: string; className?: string; "aria-label"?: string; "aria-hidden"?: boolean }) {
  return <span {...props}>{name}</span>;
}
