import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Select, type SelectProps } from "./select";

export const control = "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-primary aria-[invalid=true]:border-danger";

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}

export function FieldShell({ label, hint, error, children }: FieldShellProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    // min-w-0: inside a grid the field must not grow to the width of a long, untruncated select text (#509 rest, phone view).
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Common = { label: string; hint?: string; error?: string };

export function TextField({ label, hint, error, className = "", ...props }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return <FieldShell label={label} hint={hint} error={error}>{(a11y) => <input className={`${control} ${className}`} {...a11y} {...props} />}</FieldShell>;
}

export function TextAreaField({ label, hint, error, className = "", ...props }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <FieldShell label={label} hint={hint} error={error}>{(a11y) => <textarea className={`${control} min-h-28 ${className}`} {...a11y} {...props} />}</FieldShell>;
}

export function SelectField({ label, hint, error, className = "", children, ...props }: Common & SelectProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {(a11y) => (
        <Select className={className} {...a11y} {...props}>
          {children}
        </Select>
      )}
    </FieldShell>
  );
}
