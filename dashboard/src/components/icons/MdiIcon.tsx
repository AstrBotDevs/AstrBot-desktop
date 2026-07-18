type MdiIconProps = {
  className?: string;
  name: `mdi-${string}`;
  size?: number | string;
};

export function MdiIcon({ className = '', name, size }: MdiIconProps) {
  return (
    <span
      aria-hidden="true"
      className={`mdi ${name}${className ? ` ${className}` : ''}`}
      style={size == null ? undefined : { fontSize: size }}
    />
  );
}
