"use client";

import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode, type SelectHTMLAttributes } from "react";
import { Icon } from "./icons";

interface Option {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** Reads `<option>` children (also inside fragments and arrays) like a native select would. */
function readOptions(children: ReactNode): Option[] {
  const out: Option[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
    if (element.type === "option") {
      const text = textOf(element.props.children);
      out.push({ value: String(element.props.value ?? text), label: element.props.children, text, disabled: Boolean(element.props.disabled) });
    } else if (element.props.children) {
      out.push(...readOptions(element.props.children));
    }
  });
  return out;
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & { children: ReactNode };

/**
 * Styled replacement for `<select>` (all dropdowns of the app): a button with a glass listbox instead of the
 * grey native menu. Same props as a native select – `value`/`defaultValue`, `onChange` (receives an event with
 * `target.value`), `name` (a hidden input carries the value into forms), `disabled`, `<option>` children.
 * Keyboard: arrows, Home/End, Enter/Space, Escape, Tab and type-ahead; ARIA listbox pattern.
 */
export function Select({ children, value, defaultValue, onChange, name, disabled, className = "", id, required, ...rest }: SelectProps) {
  const options = useMemo(() => readOptions(children), [children]);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(String(defaultValue ?? options.find((o) => !o.disabled)?.value ?? ""));
  const current = controlled ? String(value) : inner;
  const selected = options.find((o) => o.value === current) ?? options[0];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [upward, setUpward] = useState(false);
  const autoId = useId();
  const buttonId = id ?? `${autoId}-button`;
  const listId = `${autoId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const openList = () => {
    if (disabled) return;
    const rect = rootRef.current?.getBoundingClientRect();
    setUpward(Boolean(rect && window.innerHeight - rect.bottom < 280 && rect.top > window.innerHeight - rect.bottom));
    setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (!controlled) setInner(option.value);
    setOpen(false);
    if (option.value !== current) onChange?.({ target: { value: option.value, name: name ?? "" }, currentTarget: { value: option.value, name: name ?? "" } } as unknown as ChangeEvent<HTMLSelectElement>);
  };

  const move = (from: number, step: number) => {
    for (let i = 1; i <= options.length; i++) {
      const next = (from + step * i + options.length * 4) % options.length;
      if (!options[next]?.disabled) return next;
    }
    return from;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    const key = event.key;
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(key)) {
      event.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (key === "ArrowDown") setActive((a) => move(a, 1));
    else if (key === "ArrowUp") setActive((a) => move(a, -1));
    else if (key === "Home") setActive(move(-1, 1));
    else if (key === "End") setActive(move(options.length, -1));
    else if (key === "Enter" || key === " ") choose(active);
    else if (key === "Escape") setOpen(false);
    else if (key === "Tab") {
      setOpen(false);
      return;
    } else if (key.length === 1) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + key.toLowerCase(), at: now };
      const hit = options.findIndex((o) => !o.disabled && o.text.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    } else return;
    event.preventDefault();
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {name ? <input type="hidden" name={name} value={current} required={required} /> : null}
      <button
        type="button"
        id={buttonId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-describedby={rest["aria-describedby"]}
        aria-invalid={rest["aria-invalid"]}
        aria-label={rest["aria-label"]}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl border border-glass-line bg-[color-mix(in_oklab,var(--surface)_70%,transparent)] px-3 py-2 text-left text-sm text-text shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] backdrop-blur transition-colors hover:border-primary/50 focus-visible:border-primary aria-expanded:border-primary aria-expanded:shadow-[0_0_0_3px_rgb(0_216_255/0.12)] disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger"
      >
        <span className="min-w-0 truncate">{selected?.label ?? " "}</span>
        <Icon name="chevron" className={`size-4 shrink-0 text-muted transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={buttonId}
          className={`absolute z-50 max-h-72 w-full min-w-max overflow-auto rounded-xl border border-glass-line bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] p-1.5 shadow-[0_18px_50px_-12px_rgb(0_0_0/0.6),0_0_30px_-14px_var(--glow-cyan)] backdrop-blur-xl ${upward ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === current;
            return (
              <li
                key={`${option.value}-${index}`}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                onPointerMove={() => !option.disabled && setActive(index)}
                onClick={() => choose(index)}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${index === active ? "bg-primary/12 text-text" : "text-muted"} ${isSelected ? "font-medium text-text" : ""} ${option.disabled ? "cursor-not-allowed opacity-40" : ""}`}
              >
                <span className="min-w-0">{option.label}</span>
                {isSelected ? <Icon name="check" className="size-4 shrink-0 text-primary" /> : <span className="size-4 shrink-0" />}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
