"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cn, focusRing } from "../ui/cn";
import { Input } from "../ui/input";

import type { AdminServerFunction, RelationOption } from "../types";
import type { KeyboardEvent } from "react";

/** Props of {@link RelationPicker}. */
export interface RelationPickerProps {
  id: string;
  name: string;
  many: boolean;
  required: boolean;
  disabled: boolean;
  describedBy: string;
  /** Selected documents when the form opens. */
  initial: RelationOption[];
  /** Server function that finds documents of the related collection by title. */
  serverFunction: AdminServerFunction;
  /** Slug of the related collection. */
  relatedSlug: string;
  /** Plural label of the related collection, for the placeholder. */
  relatedLabel: string;
}

const debounceMs = 200;

/**
 * Pick one or more related documents. Type to search by title; use the arrow keys and Enter
 * to choose. Selected ids are submitted as hidden inputs named `name`.
 */
export function RelationPicker(props: Readonly<RelationPickerProps>) {
  const { id, name, many, required, disabled, describedBy, initial, relatedLabel } = props;
  const { serverFunction, relatedSlug } = props;
  const listId = useId();
  const [selected, setSelected] = useState<RelationOption[]>(initial);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<RelationOption[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const request = ++requestRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      void serverFunction({ type: "search", slug: relatedSlug, query })
        .then((result) => {
          if (request !== requestRef.current) return;
          setOptions(result.status === "options" ? result.options : []);
        })
        .catch(() => {
          if (request === requestRef.current) setOptions([]);
        })
        .finally(() => {
          if (request === requestRef.current) setLoading(false);
        });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
    };
  }, [open, query, serverFunction, relatedSlug]);

  const chosen = new Set(selected.map((option) => option.id));
  const visible = options.filter((option) => !chosen.has(option.id));

  const choose = (option: RelationOption) => {
    setSelected(many ? [...selected, option] : [option]);
    setQuery("");
    setOpen(false);
    setActive(0);
  };

  const remove = (optionId: string) => {
    setSelected(selected.filter((option) => option.id !== optionId));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(visible.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const option = visible[active];
      if (option) choose(option);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && !disabled;
  const activeOption = showList ? visible[active] : undefined;

  return (
    <div className="qb:relative qb:space-y-2">
      {selected.map((option) => (
        <input key={option.id} type="hidden" name={name} value={option.id} />
      ))}
      {selected.length > 0 ? (
        <ul
          className={cn(
            "qb:flex qb:flex-wrap qb:items-center qb:gap-1.5",
            !many &&
              "qb:min-h-9 qb:rounded-md qb:border qb:border-zinc-300 qb:bg-white qb:px-2 qb:shadow-xs",
            !many && disabled && "qb:bg-zinc-50",
          )}
          aria-label={`Selected ${relatedLabel.toLowerCase()}`}
        >
          {selected.map((option) => (
            <li
              key={option.id}
              className="qb:inline-flex qb:items-center qb:gap-1 qb:rounded-md qb:bg-zinc-100 qb:py-0.5 qb:pr-1 qb:pl-2 qb:text-sm qb:text-zinc-800"
            >
              {option.label}
              {disabled ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${option.label}`}
                  className={cn(
                    "qb:rounded qb:px-1 qb:text-zinc-500 qb:hover:bg-zinc-200 qb:hover:text-zinc-900",
                    focusRing,
                  )}
                  onClick={() => {
                    remove(option.id);
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {disabled || (!many && selected.length > 0) ? null : (
        <Input
          id={id}
          role="combobox"
          autoComplete="off"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
          aria-describedby={describedBy}
          required={required && selected.length === 0}
          placeholder={`Search ${relatedLabel.toLowerCase()}…`}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onClick={() => {
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
          }}
          onKeyDown={onKeyDown}
        />
      )}
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="qb:absolute qb:z-20 qb:mt-1 qb:max-h-64 qb:w-full qb:overflow-y-auto qb:rounded-md qb:border qb:border-zinc-200 qb:bg-white qb:py-1 qb:text-sm qb:shadow-lg"
        >
          {visible.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${option.id}`}
              role="option"
              aria-selected={index === active}
              className={cn(
                "qb:cursor-pointer qb:px-3 qb:py-2",
                index === active ? "qb:bg-zinc-100 qb:text-zinc-900" : "qb:text-zinc-700",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
            >
              {option.label}
            </li>
          ))}
          {visible.length === 0 ? (
            <li className="qb:px-3 qb:py-2 qb:text-zinc-500">
              {loading ? "Searching…" : "No matches"}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
