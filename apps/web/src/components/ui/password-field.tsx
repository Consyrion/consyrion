"use client";

import { useState, type InputHTMLAttributes } from "react";
import { control, FieldShell } from "./field";
import { Icon } from "./icons";

/** Password input with a show/hide toggle (a real button, announced via aria-pressed). */
export function PasswordField({ label, hint, error, className = "", ...props }: { label: string; hint?: string; error?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {(a11y) => (
        <div className="relative">
          <input type={shown ? "text" : "password"} className={`${control} pr-12 ${className}`} {...a11y} {...props} />
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-pressed={shown}
            aria-label={shown ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-1 my-auto grid size-10 place-items-center rounded-lg text-muted hover:text-text"
          >
            <Icon name={shown ? "eyeOff" : "eye"} />
          </button>
        </div>
      )}
    </FieldShell>
  );
}
